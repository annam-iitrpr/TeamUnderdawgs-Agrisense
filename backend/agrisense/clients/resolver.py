"""Chooses a forecast source and degrades cleanly when one fails.

Order: CE Hub, then Open-Meteo as a live substitute. Fixtures require explicit mock mode. Every
step down is recorded in the provenance so the interface can show exactly what the
user is looking at. This function never raises.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from agrisense.config import DataMode, Settings, get_settings

from .base import DailyForecast, HourlyForecast, Provenance
from .cehub import CEHubForecastClient
from .fixtures import FixtureForecastClient
from .openmeteo import OpenMeteoForecastClient

log = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 600.0

_cache: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}


def _cache_key(kind: str, lat: float, lon: float, span: int) -> str:
    return f"{kind}:{round(lat, 3)}:{round(lon, 3)}:{span}"


def clear_forecast_cache() -> None:
    """Used by tests and by the demo reset."""
    _cache.clear()


def _degraded(provenance: Provenance, note: str) -> Provenance:
    joined = f"{provenance.note} {note}".strip() if provenance.note else note
    return Provenance(
        source=provenance.source,
        live=provenance.live,
        fetched_at=provenance.fetched_at,
        note=joined,
        substituted_for=provenance.substituted_for,
    )


class ForecastResolver:
    """The only forecast entry point the services layer uses."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.fixture = FixtureForecastClient()

    async def _cached(self, key: str, produce: Any) -> Any:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < _CACHE_TTL_SECONDS:
            return hit[1]

        lock = _locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = _cache.get(key)
            if hit and time.monotonic() - hit[0] < _CACHE_TTL_SECONDS:
                return hit[1]

            value = await produce()
            _cache[key] = (time.monotonic(), value)
            return value

    async def daily(self, lat: float, lon: float, days: int = 14) -> DailyForecast:
        return await self._cached(
            _cache_key(f"daily:{self.settings.agrisense_data_mode}", lat, lon, days),
            lambda: self._daily(lat, lon, days),
        )

    async def hourly(self, lat: float, lon: float, hours: int = 336) -> HourlyForecast:
        return await self._cached(
            _cache_key(f"hourly:{self.settings.agrisense_data_mode}", lat, lon, hours),
            lambda: self._hourly(lat, lon, hours),
        )

    async def _daily(self, lat: float, lon: float, days: int = 14) -> DailyForecast:
        notes: list[str] = []

        if self.settings.agrisense_data_mode is DataMode.MOCK:
            return await self.fixture.daily(lat, lon, days)

        if self.settings.should_try_live(self.settings.cehub_available):
            try:
                return await CEHubForecastClient(self.settings).daily(lat, lon, days)
            except (httpx.HTTPError, ValueError, KeyError, TypeError, RuntimeError) as exc:
                log.warning("CE Hub daily forecast failed: %s", type(exc).__name__)
                notes.append("CE Hub was unreachable.")

        try:
            result = await OpenMeteoForecastClient().daily(lat, lon, days)
            return DailyForecast(
                days=result.days,
                provenance=_degraded(result.provenance, " ".join(notes)),
            )
        except (httpx.HTTPError, ValueError, KeyError, TypeError, RuntimeError) as exc:
            log.warning("Open-Meteo daily forecast failed: %s", type(exc).__name__)
            notes.append("The substitute provider was also unreachable.")

        return DailyForecast(days=[], provenance=Provenance(
            source="unavailable", live=False, note=" ".join(notes)))

    async def _hourly(self, lat: float, lon: float, hours: int = 336) -> HourlyForecast:
        notes: list[str] = []

        if self.settings.agrisense_data_mode is DataMode.MOCK:
            return await self.fixture.hourly(lat, lon, hours)

        if self.settings.should_try_live(self.settings.cehub_available):
            try:
                return await CEHubForecastClient(self.settings).hourly(lat, lon, hours)
            except (httpx.HTTPError, ValueError, KeyError, TypeError, RuntimeError) as exc:
                log.warning("CE Hub hourly forecast failed: %s", type(exc).__name__)
                notes.append("CE Hub was unreachable.")

        try:
            result = await OpenMeteoForecastClient().hourly(lat, lon, hours)
            return HourlyForecast(
                hours=result.hours,
                provenance=_degraded(result.provenance, " ".join(notes)),
            )
        except (httpx.HTTPError, ValueError, KeyError, TypeError, RuntimeError) as exc:
            log.warning("Open-Meteo hourly forecast failed: %s", type(exc).__name__)
            notes.append("The substitute provider was also unreachable.")

        return HourlyForecast(hours=[], provenance=Provenance(
            source="unavailable", live=False, note=" ".join(notes)))
