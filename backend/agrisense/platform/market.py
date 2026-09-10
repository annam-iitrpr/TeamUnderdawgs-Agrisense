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

import logging
import os
import time
from datetime import date
from typing import Any

import httpx

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
    'potato': 'Potato',
    'barley': 'Barley',
    'field_pea': 'Peas(Dry)',
    'lentil': 'Lentil (Masur)(Whole)',
    'sorghum': 'Jowar(Sorghum)',
    'bajra': 'Bajra(Pearl Millet/Cumbu)',
    'groundnut': 'Groundnut',
    'onion': 'Onion',
    'tomato': 'Tomato',
    'moong': 'Green Gram (Moong)(Whole)',
    # Sugarcane is deliberately absent. It is not traded in APMC daily arrivals
    # at all -- growers sell to mills at the State Advised Price -- so it is
    # served from the reference table below, which is the correct figure for it
    # rather than a substitute for a mandi quote it never had.
}

#: A price to show when the live feed cannot supply one.
#:
#: Every entry is anchored to a published figure for the 2025-26 marketing
#: season -- the declared minimum support price where the crop has one, and the
#: Punjab State Advised Price for sugarcane, which has no MSP. The band around
#: it is the ordinary spread across mandis, not a forecast.
#:
#: This is a *reference*, and it is labelled as one everywhere it surfaces:
#: `data_mode` is 'demo' and the warnings name it, so nothing here is ever
#: presented as today's live quote from a named market. It exists so a farmer
#: comparing crops always has a figure to compare, rather than a blank.
REFERENCE_PRICES: dict[str, dict[str, Any]] = {
    'wheat': {'msp': 2425, 'low': 2350, 'modal': 2425, 'high': 2600},
    'rice': {'msp': 2369, 'low': 2300, 'modal': 2369, 'high': 2550},
    'maize': {'msp': 2400, 'low': 2050, 'modal': 2300, 'high': 2600},
    'barley': {'msp': 1980, 'low': 1850, 'modal': 1980, 'high': 2250},
    'sorghum': {'msp': 3699, 'low': 3200, 'modal': 3699, 'high': 4100},
    'bajra': {'msp': 2775, 'low': 2450, 'modal': 2775, 'high': 3050},
    'lentil': {'msp': 6700, 'low': 5900, 'modal': 6700, 'high': 7400},
    'field_pea': {'msp': None, 'low': 3400, 'modal': 4000, 'high': 4900},
    'moong': {'msp': 8768, 'low': 7800, 'modal': 8768, 'high': 9600},
    'groundnut': {'msp': 7263, 'low': 6400, 'modal': 7263, 'high': 8100},
    'cotton': {'msp': 7710, 'low': 6900, 'modal': 7710, 'high': 8400},
    'potato': {'msp': None, 'low': 800, 'modal': 1200, 'high': 1900},
    'onion': {'msp': None, 'low': 850, 'modal': 1500, 'high': 2600},
    'tomato': {'msp': None, 'low': 600, 'modal': 1500, 'high': 3100},
    # Punjab State Advised Price, not an MSP: sugarcane has none.
    'sugarcane': {'msp': None, 'low': 391, 'modal': 401, 'high': 411},
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
    """One page of quotes for a commodity, or a stated dependency failure.

    Uses httpx rather than urllib for the same reason the location search does:
    urllib against this host raised `RemoteDisconnected` from Cloud Run, which
    is a ConnectionResetError and therefore not an `URLError` — so it escaped
    the handler entirely and surfaced as a 500 instead of an honest 503.
    Everything this can raise is caught below and converted.
    """
    params = {
        'api-key': os.environ['DATA_GOV_IN_API_KEY'],
        'format': 'json',
        'limit': MAX_RECORDS,
        'filters[commodity]': commodity,
    }
    # The User-Agent is not cosmetic. data.gov.in silently blackholes requests
    # identifying as `Python-urllib/3.x` — the connection hangs until the read
    # times out rather than returning a status, so it presents as a slow network
    # and not as a rejection. The same request with any ordinary agent answers
    # in under half a second. Verified 2026-09-10 and covered by a test.
    headers = {'Accept': 'application/json', 'User-Agent': USER_AGENT}
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            response = httpx.get(ENDPOINT, params=params, headers=headers,
                                 timeout=TIMEOUT_SECONDS, follow_redirects=True)
            response.raise_for_status()
            payload = response.json()
            break
        # httpx.HTTPError covers transport, timeout and status failures; OSError
        # and ValueError cover a dropped connection and malformed JSON. None of
        # these may reach the caller as anything but a dependency problem.
        except (httpx.HTTPError, OSError, ValueError) as exc:
            last = exc
            if attempt + 1 < RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS)
    else:
        log.warning('mandi price fetch failed for %s: %s', commodity, type(last).__name__)
        raise PlatformError('DEPENDENCY_UNAVAILABLE',
                            'Market prices are unavailable right now.', 503, True) from last
    if not isinstance(payload, dict) or payload.get('status') != 'ok':
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


def reference_prices(crop_id: str, reason: str) -> c.MarketPrices:
    """The reference figure for a crop, when no live quote can be had.

    A blank where a price should be is the least useful thing this screen can
    show: a farmer comparing crops cannot compare against nothing. So a crop
    always resolves to a figure, and the figure always says what it is --
    `data_mode` is 'demo' and the warnings carry both the anchor and the reason
    the live feed was not used, so a reference is never mistaken for today's
    quote at a named mandi.
    """
    entry = REFERENCE_PRICES[crop_id]
    measure = lambda value: c.Measurement(value=float(value), unit=UNIT)  # noqa: E731
    return c.MarketPrices(
        crop_id=crop_id, commodity=COMMODITY.get(crop_id, crop_id), quotes=[],
        low=measure(entry['low']), high=measure(entry['high']), modal=measure(entry['modal']),
        msp=measure(entry['msp']) if entry['msp'] is not None else None,
        msp_missing_reason=None if entry['msp'] is not None else 'no_msp_is_declared_for_this_crop',
        retrieved_at=d.utcnow(),
        source='agrisense:reference_price_2025_26',
        data_mode='demo',
        warnings=[
            'indicative_reference_price_not_a_live_mandi_quote',
            'anchored_to_state_advised_price_2025_26'
            if crop_id == 'sugarcane' else 'anchored_to_declared_msp_2025_26'
            if entry['msp'] is not None else 'anchored_to_typical_mandi_range_2025_26',
            reason,
        ],
    )


def prices(crop_id: str, *, state: str | None = None) -> c.MarketPrices:
    """Current mandi prices for a crop, cached and never averaged nationally.

    Falls back to the reference table rather than failing. Every path that used
    to raise -- an unmapped crop, an unconfigured key, an upstream that answered
    with nothing -- ended as "not known" on the farmer's screen, which is the one
    thing a price card must not say.
    """
    commodity = COMMODITY.get(crop_id)
    if commodity is None:
        if crop_id in REFERENCE_PRICES:
            return reference_prices(crop_id, 'crop_is_not_traded_in_daily_mandi_arrivals')
        raise PlatformError('CROP_NOT_PRICED',
                            'No mandi price series is mapped for this crop.', 404)
    if not configured():
        return reference_prices(crop_id, 'live_market_feed_not_configured')

    cached = _cache.get(commodity)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return _localise(cached[1], state)

    try:
        quotes = [quote for quote in (_quote(row) for row in _fetch(commodity)) if quote is not None]
    except PlatformError:
        # An upstream outage is not a reason to show a farmer nothing.
        log.warning('mandi fetch failed for %s; serving the reference price', commodity)
        return reference_prices(crop_id, 'live_market_feed_unavailable')
    if not quotes:
        return reference_prices(crop_id, 'no_market_reported_this_crop_today')

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
        # The declared MSP for the current marketing season, from the reviewed
        # table rather than the stale machine-readable series. It is the right
        # thing to show beside a mandi range: it is the floor the range is
        # judged against.
        msp=(c.Measurement(value=float(REFERENCE_PRICES[crop_id]['msp']), unit=UNIT)
             if REFERENCE_PRICES.get(crop_id, {}).get('msp') is not None else None),
        msp_missing_reason=(None if REFERENCE_PRICES.get(crop_id, {}).get('msp') is not None
                            else 'no_msp_is_declared_for_this_crop'),
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
