"""meteoblue Dataset API client for historical weather, used by the backtest.

Verified live against the production service. One detail matters and is not obvious
from the documentation: the ERA5 domain returns null for every value on this key,
while ERA5T returns real data for the same request. ERA5T is the near real time
version of the same reanalysis, so ERA5T is used as the primary domain with ERA5
as the gap fill. See docs/CEHUB_API_NOTES.md for the evidence.

Responses are cached to backend/.cache/meteoblue keyed by a hash of the request
body, because history does not change and re-requesting it is wasteful.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date as Date
from datetime import datetime, timedelta
from typing import Any

import httpx

from agrisense.agronomy.types import DailyWeather
from agrisense.config import Settings, get_settings

from .base import DailyForecast, Provenance

TEMPERATURE_CODE = 11
PRECIPITATION_CODE = 61
HUMIDITY_CODE = 52
WIND_CODE = 32
RADIATION_CODE = 204


class MeteoblueError(RuntimeError):
    pass


class MeteoblueClient:
    """Historical daily weather for a point."""

    name = "meteoblue"

    def __init__(self, settings: Settings | None = None, timeout: float = 90.0) -> None:
        self.settings = settings or get_settings()
        self.timeout = timeout

    def _build_body(self, lat: float, lon: float, start: Date, end: Date) -> dict[str, Any]:
        return {
            "units": {
                "temperature": "C",
                "velocity": "km/h",
                "length": "metric",
                "energy": "watts",
            },
            "geometry": {
                "type": "MultiPoint",
                "coordinates": [[lon, lat]],
            },
            "format": "json",
            "timeIntervals": [f"{start.isoformat()}T+00:00/{end.isoformat()}T+00:00"],
            "timeIntervalsAlignment": "none",
            "queries": [
                {
                    "domain": "ERA5T",
                    "gapFillDomain": "ERA5",
                    "timeResolution": "daily",
                    "codes": [
                        {"code": TEMPERATURE_CODE, "level": "2 m above gnd", "aggregation": "max"},
                        {"code": TEMPERATURE_CODE, "level": "2 m above gnd", "aggregation": "min"},
                        {"code": PRECIPITATION_CODE, "level": "sfc", "aggregation": "sum"},
                    ],
                }
            ],
        }

    def _cache_path(self, body: dict[str, Any]):
        digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:24]
        directory = self.settings.cache_dir / "meteoblue"
        directory.mkdir(parents=True, exist_ok=True)
        return directory / f"{digest}.json"

    async def _post(self, body: dict[str, Any]) -> Any:
        cache = self._cache_path(body)
        if cache.exists():
            return json.loads(cache.read_text())

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.settings.meteoblue_base_url}/dataset/query",
                params={"apikey": self.settings.meteoblue_api_key},
                json=body,
            )
            response.raise_for_status()
            payload = response.json()

            if isinstance(payload, dict) and payload.get("status") in {"waiting", "running"}:
                payload = await self._poll(client, str(payload.get("id")))

        cache.write_text(json.dumps(payload))
        return payload

    async def _poll(self, client: httpx.AsyncClient, job_id: str, attempts: int = 30) -> Any:
        import asyncio

        for _ in range(attempts):
            await asyncio.sleep(2.0)
            status = await client.get(f"{self.settings.meteoblue_base_url}/queue/status/{job_id}")
            status.raise_for_status()
            state = status.json()

            if state.get("status") == "finished":
                result = await client.get(f"{self.settings.meteoblue_base_url}/queue/result/{job_id}")
                result.raise_for_status()
                return result.json()

            if state.get("status") in {"error", "failed"}:
                raise MeteoblueError(f"meteoblue job {job_id} failed")

        raise MeteoblueError(f"meteoblue job {job_id} did not finish in time")

    async def history(self, lat: float, lon: float, start: Date, end: Date) -> DailyForecast:
        if not self.settings.meteoblue_available:
            raise MeteoblueError("No meteoblue API key configured")

        payload = await self._post(self._build_body(lat, lon, start, end))

        if not (isinstance(payload, list) and payload):
            raise MeteoblueError("meteoblue returned an unexpected payload shape")

        block = payload[0]
        stamps = block["timeIntervals"][0]
        codes = block["codes"]

        def series(index: int) -> list[float | None]:
            return codes[index]["dataPerTimeInterval"][0]["data"][0]

        tmax, tmin, precip = series(0), series(1), series(2)

        out = []
        for i, stamp in enumerate(stamps):
            if tmax[i] is None or tmin[i] is None:
                continue

            day = datetime.strptime(str(stamp)[:8], "%Y%m%d").date()
            out.append(
                DailyWeather(
                    date=day,
                    tmax_c=float(tmax[i]),
                    tmin_c=float(tmin[i]),
                    precipitation_mm=float(precip[i] or 0.0),
                    humidity_pct=60.0,
                    wind_kmh=8.0,
                    solar_wh_m2=5200.0,
                )
            )

        if not out:
            raise MeteoblueError("meteoblue returned only null values for this location and period")

        return DailyForecast(
            days=out,
            provenance=Provenance(
                source="meteoblue Dataset API, ERA5T reanalysis",
                live=True,
                note="Historical reanalysis. Humidity, wind and radiation use seasonal defaults.",
            ),
        )

    async def season(self, lat: float, lon: float, sowing: Date, until: Date) -> DailyForecast:
        end = min(until, Date.today() - timedelta(days=6))
        if end <= sowing:
            end = sowing + timedelta(days=1)
        return await self.history(lat, lon, sowing, end)
