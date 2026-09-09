"""Syngenta CE Hub forecast client.

Discovered contract, verified live against the production service:

  spec      GET /swagger/v1.0/swagger.json    (not /swagger/v1/swagger.json)
  auth      ApiKey request header
  daily     GET /api/Forecast/ShortRangeForecastDaily
  hourly    GET /api/Forecast/ShortRangeForecastHourly
  catalogue GET /api/Forecast/Metadata

The single most important detail: measureLabel must be the exact label string from
the Metadata catalogue including its unit suffix, for example "TempAir_Hourly (C)".
Passing "TempAir_Hourly" returns HTTP 204 with an empty body rather than an error,
so a wrong label looks like a successful request that found no data. Every label
below is copied verbatim from the live Metadata response.

See docs/CEHUB_API_NOTES.md for the full discovery record.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import UTC, datetime, timedelta, timezone
from math import isfinite
from typing import Any

import httpx

from agrisense.agronomy.types import DailyWeather, HourlyWeather
from agrisense.config import Settings, get_settings

from .base import DailyForecast, HourlyForecast, Provenance

DAILY_MEASURES: dict[str, str] = {
    "tmax_c": "TempAir_DailyMax (C)",
    "tmin_c": "TempAir_DailyMin (C)",
    "precipitation_mm": "Precip_DailySum (mm)",
    "humidity_pct": "HumidityRel_DailyAvg (pct)",
    "wind_ms": "WindSpeed_DailyAvg (m/s)",
    "solar_wh_m2": "GlobalRadiation_DailySum (Wh/m2)",
}

HOURLY_MEASURES: dict[str, str] = {
    "temperature_c": "TempAir_Hourly (C)",
    "humidity_pct": "HumidityRel_Hourly (pct)",
    "precipitation_mm": "Precip_HourlySum (mm)",
    "wind_ms": "WindSpeed_Hourly (m/s)",
    "solar_wh_m2": "GlobalRadiation_HourlySum (Wh/m2)",
}

MS_TO_KMH = 3.6


class CEHubError(RuntimeError):
    pass


def _auth_headers(settings: Settings) -> dict[str, str]:
    """Build headers for whichever auth variant is configured.

    Verified working: the ApiKey header. The others are kept because the service
    may be deployed differently for other teams.
    """
    if settings.cehub_api_key and settings.cehub_bearer_token:
        raise CEHubError("select exactly one authentication mode")
    if settings.cehub_api_key:
        return {settings.cehub_api_key_header: settings.cehub_api_key}
    if settings.cehub_bearer_token:
        return {"Authorization": f"Bearer {settings.cehub_bearer_token}"}
    return {}


def _parse_value(raw: Any) -> float | None:
    """CE Hub returns every value as a string, including empty ones."""
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
        return value if isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _row_value(row: dict[str, Any]) -> float | None:
    """Read the measurement out of a row.

    The daily endpoint returns the number under "dailyValue" while the hourly
    endpoint returns it under "value". Both are checked because the difference is
    undocumented and silently produces an empty forecast if only one is handled.
    """
    for key in ("value", "dailyValue", "hourlyValue"):
        if key in row:
            parsed = _parse_value(row[key])
            if parsed is not None:
                return parsed
    return None


def _parse_timestamp(raw: str, offset: float) -> datetime | None:
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone(timedelta(hours=offset)))
        except (TypeError, ValueError):
            continue
    return None


class CEHubForecastClient:
    """Live forecast from CE Hub, one request per measure."""

    name = "cehub"

    def __init__(self, settings: Settings | None = None, timeout: float = 20.0) -> None:
        self.settings = settings or get_settings()
        self.timeout = timeout

    async def _fetch_measure(
        self,
        client: httpx.AsyncClient,
        endpoint: str,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        label: str,
    ) -> list[dict[str, Any]]:
        response = await client.get(
            f"{self.settings.cehub_base_url}/api/Forecast/{endpoint}",
            params={
                "latitude": lat,
                "longitude": lon,
                "startDate": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "endDate": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "supplier": "Meteoblue",
                "measureLabel": label,
                "format": "json",
            },
            headers=_auth_headers(self.settings),
        )

        if response.status_code == 204:
            raise CEHubError(f"CE Hub returned no content for measure {label!r}")

        response.raise_for_status()
        payload = response.json()

        if not isinstance(payload, list):
            raise CEHubError("CE Hub returned an unexpected payload shape")

        return payload

    async def _gather(
        self,
        endpoint: str,
        measures: dict[str, str],
        lat: float,
        lon: float,
        span_days: int,
    ) -> dict[str, dict[datetime, float]]:
        start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=span_days)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            results = await asyncio.gather(
                *(
                    self._fetch_measure(client, endpoint, lat, lon, start, end, label)
                    for label in measures.values()
                )
            )

        by_field: dict[str, dict[datetime, float]] = {}
        for field_name, rows in zip(measures.keys(), results, strict=True):
            series: dict[datetime, float] = {}
            for row in rows:
                if "offset" not in row:
                    raise CEHubError("provider timezone offset is missing")
                stamp = _parse_timestamp(str(row.get("date", "")), float(row["offset"]))
                value = _row_value(row)
                if stamp is not None and value is not None:
                    if stamp in series:
                        raise CEHubError("duplicate provider timestamp")
                    series[stamp] = value
            by_field[field_name] = series

        return by_field

    async def daily(self, lat: float, lon: float, days: int = 14) -> DailyForecast:
        data = await self._gather("ShortRangeForecastDaily", DAILY_MEASURES, lat, lon, days)

        buckets: dict[Any, dict[str, float]] = defaultdict(dict)
        for field_name, series in data.items():
            for stamp, value in series.items():
                buckets[stamp.date()][field_name] = value

        out = []
        for day in sorted(buckets):
            row = buckets[day]
            if not set(DAILY_MEASURES).issubset(row):
                continue

            out.append(
                DailyWeather(
                    date=day,
                    tmax_c=row["tmax_c"],
                    tmin_c=row["tmin_c"],
                    precipitation_mm=row["precipitation_mm"],
                    humidity_pct=row["humidity_pct"],
                    wind_kmh=row["wind_ms"] * MS_TO_KMH,
                    solar_wh_m2=row["solar_wh_m2"],
                )
            )

        if not out:
            raise CEHubError("CE Hub returned no usable daily rows")

        return DailyForecast(
            days=out[:days],
            provenance=Provenance(
                source="Syngenta CE Hub, ShortRangeForecastDaily, supplier Meteoblue",
                live=True,
            ),
        )

    async def hourly(self, lat: float, lon: float, hours: int = 336) -> HourlyForecast:
        span_days = max(1, hours // 24)
        data = await self._gather("ShortRangeForecastHourly", HOURLY_MEASURES, lat, lon, span_days)

        buckets: dict[Any, dict[str, float]] = defaultdict(dict)
        for field_name, series in data.items():
            for stamp, value in series.items():
                buckets[stamp][field_name] = value

        out = []
        for stamp in sorted(buckets):
            row = buckets[stamp]
            if not set(HOURLY_MEASURES).issubset(row):
                continue

            out.append(
                HourlyWeather(
                    timestamp=stamp.astimezone(UTC),
                    temperature_c=row["temperature_c"],
                    humidity_pct=row["humidity_pct"],
                    wind_kmh=row["wind_ms"] * MS_TO_KMH,
                    precipitation_mm=row["precipitation_mm"],
                    solar_wh_m2=row["solar_wh_m2"],
                )
            )

        if not out:
            raise CEHubError("CE Hub returned no usable hourly rows")

        return HourlyForecast(
            hours=out[:hours],
            provenance=Provenance(
                source="Syngenta CE Hub, ShortRangeForecastHourly, supplier Meteoblue",
                live=True,
            ),
        )
