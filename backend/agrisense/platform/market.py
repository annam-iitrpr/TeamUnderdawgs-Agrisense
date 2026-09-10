"""Live mandi prices from the Government of India open-data API.

What a crop is fetching at an APMC market is an *observation*, not a forecast,
and the whole value of it is that it is specific: prices differ by mandi,
variety and grade on the same day. So this module keeps the individual quotes
and reports a range, never a single national average that no farmer could
actually obtain.

Two operational constraints shape the design:

  - The upstream is a shared public API with a modest rate limit. Every farmer
    opening a crop card must not become an upstream request, so results are
    cached per crop for a working day's worth of usefulness.
  - Prices are published per commodity name, and those names are the market's
    own, not ours: rice trades as "Paddy" and soybean as "Soyabean". The
    mapping is explicit data rather than a guess at pluralisation.
"""
from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Any

from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform.errors import PlatformError

log = logging.getLogger('agrisense.platform.market')

RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070'
ENDPOINT = f'https://api.data.gov.in/resource/{RESOURCE_ID}'

#: Must not begin with "Python-urllib" — see the note in `_fetch`.
USER_AGENT = 'AgriSense/1.0 (+https://agrisense.spacesdrive.cc)'

#: Our crop ids to the commodity names the mandi feed actually publishes.
#: Verified against the live API on 2026-09-10: every name here returned
#: records, and the obvious guesses that did not ("Soybean", "Soyabin") are
#: recorded in the tests so nobody reintroduces them.
COMMODITY = {
    'cotton': 'Cotton',
    'wheat': 'Wheat',
    'rice': 'Paddy',
    'maize': 'Maize',
    'soybean': 'Soyabean',
}

#: Mandi prices are reported per quintal throughout this feed.
UNIT = 'INR/quintal'

#: Long enough that a burst of farmers costs one upstream call, short enough
#: that a price never survives past the trading day it describes.
CACHE_SECONDS = 60 * 30
MAX_RECORDS = 200
TIMEOUT_SECONDS = 25
#: One retry, because this upstream is normally sub-second but blips. A single
#: transient read timeout should not become a farmer-visible outage, and more
#: than one retry would just make them wait longer for the same answer.
RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.5

_cache: dict[str, tuple[float, c.MarketPrices]] = {}


def configured() -> bool:
    return bool(os.getenv('DATA_GOV_IN_API_KEY'))


def _fetch(commodity: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({
        'api-key': os.environ['DATA_GOV_IN_API_KEY'],
        'format': 'json',
        'limit': MAX_RECORDS,
        'filters[commodity]': commodity,
    })
    # The User-Agent is not cosmetic. data.gov.in silently blackholes requests
    # identifying as `Python-urllib/3.x` — the connection hangs until the read
    # times out rather than returning a status, so it presents as a slow network
    # and not as a rejection. The same request with any ordinary agent answers
    # in under half a second. Verified 2026-09-10 and covered by a test.
    request = urllib.request.Request(f'{ENDPOINT}?{query}', headers={
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
    })
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                payload = json.load(response)
            break
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            last = exc
            if attempt + 1 < RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS)
    else:
        log.warning('mandi price fetch failed for %s', commodity, exc_info=last)
        raise PlatformError('DEPENDENCY_UNAVAILABLE',
                            'Market prices are unavailable right now.', 503, True) from last
    if payload.get('status') != 'ok':
        raise PlatformError('DEPENDENCY_UNAVAILABLE',
                            'The market price service rejected the request.', 503, True)
    return [row for row in (payload.get('records') or []) if isinstance(row, dict)]


def _number(raw: Any) -> float | None:
    """A price, or None when the feed reports something unusable.

    Blank strings and zeroes both appear in this feed for markets that reported
    no trade. A zero price is not a real price, and carrying it into a range
    would drag the low end to nothing.
    """
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _parse_date(raw: Any) -> date | None:
    """The arrival date, as a calendar date.

    Parsed into a `date` directly rather than through `strptime`, which would
    build a naive datetime for a value that has no time in it at all — an
    arrival date is the trading day, and attaching a timezone to it would imply
    a precision the feed does not have. The feed writes DD/MM/YYYY; ISO is
    accepted too because the same resource has served both.
    """
    text = str(raw).strip()
    for separator, order in (('/', (2, 1, 0)), ('-', (0, 1, 2))):
        parts = text.split(separator)
        if len(parts) != 3:
            continue
        try:
            year, month, day = (int(parts[index]) for index in order)
            return date(year, month, day)
        except ValueError:
            continue
    return None


def _quote(row: dict[str, Any]) -> c.MarketQuote | None:
    minimum, maximum, modal = (_number(row.get(key)) for key in
                               ('min_price', 'max_price', 'modal_price'))
    reported = _parse_date(row.get('arrival_date'))
    if minimum is None or maximum is None or modal is None or reported is None:
        return None
    if maximum < minimum:
        # A market whose maximum is below its minimum has mis-reported; using it
        # would widen the range in the wrong direction.
        return None
    measure = lambda value: c.Measurement(value=value, unit=UNIT)  # noqa: E731
    return c.MarketQuote(
        market=str(row.get('market') or '').strip() or 'unnamed market',
        district=str(row.get('district') or '').strip(),
        state=str(row.get('state') or '').strip(),
        variety=str(row.get('variety') or '').strip() or None,
        grade=str(row.get('grade') or '').strip() or None,
        minimum=measure(minimum), maximum=measure(maximum), modal=measure(modal),
        reported_on=reported,
    )


def prices(crop_id: str, *, state: str | None = None) -> c.MarketPrices:
    """Current mandi prices for a crop, cached and never averaged nationally."""
    commodity = COMMODITY.get(crop_id)
    if commodity is None:
        raise PlatformError('CROP_NOT_PRICED',
                            'No mandi price series is mapped for this crop.', 404)
    if not configured():
        raise PlatformError('DEPENDENCY_UNAVAILABLE',
                            'Market prices are not configured.', 503, True)

    cached = _cache.get(commodity)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return _localise(cached[1], state)

    quotes = [quote for quote in (_quote(row) for row in _fetch(commodity)) if quote is not None]
    if not quotes:
        raise PlatformError('DEPENDENCY_UNAVAILABLE',
                            'No market reported a usable price for this crop today.', 503, True)

    # The spread across reporting markets. `low` is the lowest minimum and
    # `high` the highest maximum, because that is the range a farmer could
    # actually meet — not the spread of modal prices, which understates it.
    low = min(q.minimum.value for q in quotes if q.minimum.value is not None)
    high = max(q.maximum.value for q in quotes if q.maximum.value is not None)
    modals = sorted(q.modal.value for q in quotes if q.modal.value is not None)
    modal = modals[len(modals) // 2]

    measure = lambda value: c.Measurement(value=value, unit=UNIT)  # noqa: E731
    result = c.MarketPrices(
        crop_id=crop_id, commodity=commodity, quotes=quotes,
        low=measure(low), high=measure(high), modal=measure(modal),
        msp=None,
        msp_missing_reason='current_declared_msp_series_unavailable',
        retrieved_at=d.utcnow(), source='data.gov.in:agmarknet_daily_prices',
        data_mode='live',
        warnings=[
            'prices_are_reported_arrivals_not_a_forecast',
            f'reported_by_{len(quotes)}_markets',
        ],
    )
    _cache[commodity] = (time.monotonic(), result)
    return _localise(result, state)


def _localise(result: c.MarketPrices, state: str | None) -> c.MarketPrices:
    """Pick out the farmer's own state, if any market there reported.

    A price 1500 km away is not a price they can get, so the nearest quote is
    left null rather than filled with the closest thing available.
    """
    if not state:
        return result.model_copy(update={'nearest': None})
    wanted = state.strip().lower()
    local = [q for q in result.quotes if q.state.lower() == wanted]
    if not local:
        return result.model_copy(update={
            'nearest': None,
            'warnings': [*result.warnings, 'no_market_in_your_state_reported_today'],
        })
    # The median local market by modal price, so one unusual mandi does not
    # become "the" local price.
    local.sort(key=lambda q: q.modal.value or 0)
    return result.model_copy(update={'nearest': local[len(local) // 2]})


def reset_cache_for_tests() -> None:
    _cache.clear()
