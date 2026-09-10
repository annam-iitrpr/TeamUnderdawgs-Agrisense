"""Gridded soil estimates from ISRIC SoilGrids, for fields with no soil test.

The crop planner will not rank a crop without a soil pH, and a Soil Health Card
is the only soil input most farmers can supply — which they mostly do not have
to hand. Without a fallback the planner declines every crop and the farmer is
told to go and find a lab report, which is not a reasonable answer to "what
should I sow".

SoilGrids is a global 250 m modelled product. It is a genuine estimate, not a
measurement of anyone's field, and everything here is built so nothing can
mistake it for one:

  - the observation is stored with `source='gridded_estimate'`, which is the
    contract's own vocabulary for exactly this;
  - it is never marked confirmed. A farmer confirms their own card; nobody can
    confirm a model on their behalf;
  - a real soil test always wins, because `select_soil` prefers confirmed
    observations and this is not one.

The value is in unblocking a ranking that would otherwise not happen at all,
while every screen keeps saying where the number came from.
"""
from __future__ import annotations

import json
import logging
import time
from functools import lru_cache

import httpx

from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.science.references import reference_dir

log = logging.getLogger('agrisense.platform.soilgrids')

ENDPOINT = 'https://rest.isric.org/soilgrids/v2.0/properties/query'
#: Retrievals already made from SoilGrids, kept because the service is
#: intermittently unavailable — it has returned both 503s and 60-second hangs
#: within a single afternoon. Each entry is a real recorded response with its
#: query and date, and applies only within a small box around the point it was
#: queried at, so a cached value can never be stretched to a district nobody
#: sampled. Loaded from the reference directory, not embedded here.
CACHE_FILE = 'soil-estimates.json'
#: The rooting layers that matter for a seed-bed decision. Deeper layers exist
#: and are not asked for: they would drag a topsoil pH towards subsoil values.
DEPTHS = ('0-5cm', '5-15cm')
PROPERTIES = ('phh2o', 'clay', 'sand', 'soc')
TIMEOUT_SECONDS = 8
CACHE_SECONDS = 60 * 60 * 24 * 30
#: Rounded to about a kilometre. The product is 250 m gridded, so a finer key
#: would just multiply cache misses for the same answer.
COORDINATE_PRECISION = 2

_cache: dict[tuple[float, float], tuple[float, dict[str, float]]] = {}


def _query(latitude: float, longitude: float) -> dict[str, float]:
    """Mean values by property, already divided by the published scale factor."""
    params: list[tuple[str, str]] = [('lon', f'{longitude:.5f}'), ('lat', f'{latitude:.5f}'),
                                     ('value', 'mean')]
    params += [('property', name) for name in PROPERTIES]
    params += [('depth', depth) for depth in DEPTHS]
    response = httpx.get(ENDPOINT, params=params, timeout=TIMEOUT_SECONDS,
                         headers={'Accept': 'application/json',
                                  'User-Agent': 'AgriSense/1.0 (+https://agrisense.spacesdrive.cc)'})
    response.raise_for_status()
    payload = response.json()

    out: dict[str, float] = {}
    for layer in ((payload.get('properties') or {}).get('layers') or []):
        name = layer.get('name')
        factor = ((layer.get('unit_measure') or {}).get('d_factor')) or 1
        readings = []
        for depth in layer.get('depths') or []:
            value = (depth.get('values') or {}).get('mean')
            if isinstance(value, (int, float)):
                readings.append(float(value) / float(factor))
        if name and readings:
            # Mean of the sampled depths: a seed bed sees both.
            out[str(name)] = sum(readings) / len(readings)
    return out


def texture_class(clay_pct: float, sand_pct: float) -> str:
    """A coarse USDA-style class, enough to say "sandy" or "clayey" in words.

    Deliberately coarse. The full USDA triangle needs silt as well and would
    imply a confidence a 250 m model does not have.
    """
    if clay_pct >= 40:
        return 'clay'
    if sand_pct >= 70:
        return 'sandy'
    if clay_pct >= 27:
        return 'clay loam'
    if sand_pct >= 52:
        return 'sandy loam'
    return 'loam'


@lru_cache(maxsize=1)
def _retrievals() -> tuple[dict, ...]:
    directory = reference_dir()
    if directory is None:
        return ()
    path = directory / CACHE_FILE
    if not path.is_file():
        return ()
    try:
        loaded = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return ()
    rows = loaded.get('retrievals') or []
    return tuple(row for row in rows if isinstance(row, dict))


def _cached_for(latitude: float, longitude: float) -> dict[str, float] | None:
    """A previously recorded retrieval, if one was made near this point.

    Near is deliberately strict. A soil estimate a hundred kilometres away is
    not this field's soil, and offering one would be worse than reporting the
    gap: the whole reason this exists is to open a pH gate honestly.
    """
    for row in _retrievals():
        at = row.get('measured_at') or {}
        span = float(row.get('applies_within_degrees') or 0)
        try:
            near_lat = abs(float(at['latitude']) - latitude) <= span
            near_lon = abs(float(at['longitude']) - longitude) <= span
        except (KeyError, TypeError, ValueError):
            continue
        if span > 0 and near_lat and near_lon:
            values: dict[str, float] = {}
            if isinstance(row.get('ph'), (int, float)):
                values['phh2o'] = float(row['ph'])
            for source, target in (('clay_pct', 'clay'), ('sand_pct', 'sand')):
                if isinstance(row.get(source), (int, float)):
                    # Stored as percentages; the live path works in the API's
                    # own g/kg-scaled units, so they are converted back.
                    values[target] = float(row[source]) * 10
            if isinstance(row.get('organic_carbon_pct'), (int, float)):
                values['soc'] = float(row['organic_carbon_pct']) * 10
            if 'phh2o' in values:
                values['_cached'] = 1.0
                return values
    return None


def estimate(field_id: str, latitude: float, longitude: float) -> c.SoilObservation | None:
    """A gridded soil observation, or None when the service cannot answer.

    None rather than a raise: this is a fallback that improves a ranking, and a
    SoilGrids outage must not stop an evaluation that would otherwise succeed.
    """
    key = (round(latitude, COORDINATE_PRECISION), round(longitude, COORDINATE_PRECISION))
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        values = cached[1]
    else:
        try:
            values = _query(latitude, longitude)
        except (httpx.HTTPError, OSError, ValueError) as exc:
            log.info('soilgrids live query failed for %s: %s', field_id, type(exc).__name__)
            values = {}
        if not values:
            # Fall back to a retrieval already recorded near this point. The
            # service hangs or 503s often enough that depending on it in the
            # request path meant the pH gate stayed shut and every crop was
            # declined — which is the failure this whole path exists to avoid.
            cached = _cached_for(latitude, longitude)
            if cached is None:
                return None
            values = cached
        _cache[key] = (time.monotonic(), values)

    ph = values.get('phh2o')
    if ph is None or not 3 <= ph <= 11:
        # Without a usable pH there is nothing here worth storing: pH is the
        # gate this exists to open.
        return None

    from_cache = values.get('_cached') == 1.0
    provenance = [c.Provenance(
        source='isric:soilgrids_v2.0', retrieved_at=d.utcnow(), data_mode='estimated',
        note=('250 m modelled estimate, not a measurement of this field'
              + ('; a retrieval recorded earlier for this area, because the '
                 'service was unreachable' if from_cache else '')))]
    clay, sand, soc = values.get('clay'), values.get('sand'), values.get('soc')
    measure = lambda value, unit, analyte: c.Measurement(  # noqa: E731
        value=round(value, 2), unit=unit, analyte=analyte, method='gridded_model',
        provenance=provenance)

    return c.SoilObservation(
        id=d.new_id(), field_id=field_id,
        # Deliberately not dated today. A modelled long-term average is not a
        # sample taken this morning, and dating it as one would let it satisfy
        # checks that exist to require a fresh reading.
        sampled_on=None,
        depth_cm=15,
        ph=measure(ph, 'pH', 'pH'),
        organic_carbon=None if soc is None else measure(soc / 10, '%', 'organic_carbon'),
        texture=None if clay is None or sand is None else texture_class(clay / 10, sand / 10),
        source='gridded_estimate',
        # Never confirmed. A farmer confirms their own card; nobody can confirm
        # a model on their behalf, and `select_soil` prefers confirmed records
        # so a real soil test always wins over this.
        confirmation_state='draft',
        version=1,
    )


def reset_cache_for_tests() -> None:
    _cache.clear()
