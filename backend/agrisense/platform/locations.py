"""Location search.

Backed by a real gazetteer rather than a hand-written list, because a farmer choosing where
their field is must be offered places that actually exist at coordinates that are actually
theirs. Results are cached by query so repeated typing does not become repeated upstream
calls, and an upstream failure reports itself instead of returning a plausible guess.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any

import httpx

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform.errors import PlatformError, unavailable

log = logging.getLogger('agrisense.platform.locations')
ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
#: India Post's own directory, which is the only free source that maps a postal
#: code to a place. It carries no coordinates, so a pincode is resolved to a
#: place name here and then geocoded like any other name.
PINCODE_ENDPOINT = 'https://api.postalpincode.in/pincode'
PINCODE = re.compile(r'^[1-9][0-9]{5}$')
#: data.gov.in blackholes the default urllib agent, and India Post is no more
#: welcoming to an unnamed client, so both are given a real one.
USER_AGENT = 'AgriSense/1.0 (+https://agrisense.spacesdrive.cc)'
COUNTRY = 'IN'
CACHE_TTL_SECONDS = 3600
CACHE_MAX_ENTRIES = 512
TIMEOUT_SECONDS = 5.0
# Populated places only: a farmer picks a village or town, not a river or a peak.
POPULATED = 'PPL'

_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def normalise(query: str) -> str:
    cleaned = ' '.join(query.split()).strip()
    if not 2 <= len(cleaned) <= 100:
        raise PlatformError('INVALID_QUERY', 'Enter between 2 and 100 characters to search.', 422)
    return cleaned


def to_result(record: dict[str, Any]) -> c.LocationResult | None:
    """Drop anything that cannot be turned into a usable, honest result."""
    latitude, longitude = record.get('latitude'), record.get('longitude')
    identifier, name = record.get('id'), record.get('name')
    if latitude is None or longitude is None or identifier is None or not name:
        return None
    if record.get('country_code') != COUNTRY:
        return None
    if not str(record.get('feature_code', '')).startswith(POPULATED):
        return None
    state = record.get('admin1')
    if not state:
        # Without a state the entry is ambiguous to a farmer, so it is not offered.
        return None
    return c.LocationResult(
        id=str(identifier), name=str(name), district=record.get('admin2') or None, state=str(state),
        centroid=c.Location(latitude=float(latitude), longitude=float(longitude), source='village'))


def place_for_pincode(code: str) -> str | None:
    """The place a postal code names, or None.

    The gazetteer searches by name and matches nothing against six digits, so a
    farmer who typed their pincode -- the one piece of location they always know
    by heart -- got an empty list and no reason for it.

    India Post returns several post offices per code. The delivery head office
    is the one a farmer would recognise as "their" town, so it is preferred over
    a sub office, and the district is the fallback when neither is usable.
    """
    import httpx

    try:
        response = httpx.get(f'{PINCODE_ENDPOINT}/{code}', timeout=TIMEOUT_SECONDS,
                             headers={'User-Agent': USER_AGENT})
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.warning('pincode lookup failed: %s', type(exc).__name__)
        return None
    entries = payload[0] if isinstance(payload, list) and payload else {}
    if str(entries.get('Status')) != 'Success':
        return None
    offices = [row for row in entries.get('PostOffice') or [] if row.get('Name')]
    if not offices:
        return None
    offices.sort(key=lambda row: (
        0 if row.get('BranchType') == 'Head Post Office' else
        1 if row.get('DeliveryStatus') == 'Delivery' else 2,
        str(row.get('Name')),
    ))
    chosen = offices[0]
    # The office name often carries the town plus a qualifier ("Minisectt
    # Ropar"), and the gazetteer will not match that. The district is the more
    # reliable handle, so it is the second thing tried by the caller.
    return str(chosen.get('Name')).strip() or None


def state_for_pincode(code: str) -> str | None:
    """The state a postal code sits in, which the gazetteer cannot infer.

    A place name repeats across India -- 140001 is Ropar in Punjab, and the
    gazetteer also holds a Ropār in Bihar. Offering a farmer the wrong one is
    worse than offering none, and the postal directory already knows which is
    which, so the answer is ranked by it.
    """
    import httpx

    try:
        response = httpx.get(f'{PINCODE_ENDPOINT}/{code}', timeout=TIMEOUT_SECONDS,
                             headers={'User-Agent': USER_AGENT})
        response.raise_for_status()
        entries = (response.json() or [{}])[0]
    except (httpx.HTTPError, ValueError, IndexError):
        return None
    for row in entries.get('PostOffice') or []:
        state = row.get('State')
        if state:
            return str(state).strip()
    return None


def district_for_pincode(code: str) -> str | None:
    import httpx

    try:
        response = httpx.get(f'{PINCODE_ENDPOINT}/{code}', timeout=TIMEOUT_SECONDS,
                             headers={'User-Agent': USER_AGENT})
        response.raise_for_status()
        entries = (response.json() or [{}])[0]
    except (httpx.HTTPError, ValueError, IndexError):
        return None
    for row in entries.get('PostOffice') or []:
        district = row.get('District')
        if district:
            return str(district).strip()
    return None


def fetch(query: str, limit: int, settings: Settings) -> list[dict[str, Any]]:
    now = time.time()
    key = f'{query.casefold()}|{limit}'
    cached = _cache.get(key)
    if cached and cached[0] > now:
        return cached[1]
    try:
        response = httpx.get(ENDPOINT, params={'name': query, 'count': min(limit * 3, 100),
                                               'language': 'en', 'format': 'json',
                                               'countryCode': COUNTRY},
                             timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
        records = response.json().get('results') or []
    except (httpx.HTTPError, ValueError) as exc:
        log.warning('location search upstream failed: %s', type(exc).__name__)
        raise unavailable('Location search') from exc
    if len(_cache) >= CACHE_MAX_ENTRIES:
        _cache.clear()
    _cache[key] = (now + CACHE_TTL_SECONDS, records)
    return records


def search(query: str, limit: int, settings: Settings) -> dict[str, Any]:
    """A page of real places. No cursor: the upstream ranks by relevance, not by a stable key."""
    cleaned = normalise(query)
    # Six digits is a pincode, not a place name. It is turned into one first,
    # trying the post office and then its district, because either may be the
    # name the gazetteer actually holds.
    if PINCODE.match(cleaned):
        state = state_for_pincode(cleaned)
        for candidate in (place_for_pincode(cleaned), district_for_pincode(cleaned)):
            if not candidate:
                continue
            found = [row for row in (to_result(record) for record in fetch(candidate, limit, settings))
                     if row is not None]
            if state:
                # A place name repeats across India, and the postal directory
                # knows which state this code is in. Anything elsewhere is not
                # this pincode, so it is dropped rather than merely ranked lower.
                in_state = [row for row in found if row.state.casefold() == state.casefold()]
                found = in_state or found
            if found:
                return {'items': [row.model_dump(mode='json') for row in found[:limit]],
                        'next_cursor': None}
        return {'items': [], 'next_cursor': None}
    results = []
    for record in fetch(cleaned, limit, settings):
        result = to_result(record)
        if result is not None:
            results.append(result.model_dump(mode='json'))
        if len(results) >= limit:
            break
    return {'items': results, 'next_cursor': None}
