"""Location search.

Backed by a real gazetteer rather than a hand-written list, because a farmer choosing where
their field is must be offered places that actually exist at coordinates that are actually
theirs. Results are cached by query so repeated typing does not become repeated upstream
calls, and an upstream failure reports itself instead of returning a plausible guess.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform.errors import PlatformError, unavailable

log = logging.getLogger('agrisense.platform.locations')
ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
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
    results = []
    for record in fetch(cleaned, limit, settings):
        result = to_result(record)
        if result is not None:
            results.append(result.model_dump(mode='json'))
        if len(results) >= limit:
            break
    return {'items': results, 'next_cursor': None}
