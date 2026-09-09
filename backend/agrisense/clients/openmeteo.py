"""Open-Meteo forecast client. Needs no key at all.

Used as the live substitute when CE Hub is unreachable, so the demo can still show
real current weather. Its provenance is always labelled as a substitute so nobody
mistakes it for the Syngenta service.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from datetime import date as Date

import httpx

from agrisense.agronomy.types import DailyWeather, HourlyWeather
from agrisense.science.units import finite

from .base import DailyForecast, HourlyForecast, Provenance

BASE_URL = "https://api.open-meteo.com/v1/forecast"


def _required(data: dict, key: str, index: int) -> float:
    try:
        value = data[key][index]
    except (KeyError, IndexError, TypeError):
        raise ValueError("legacy weather shape requires complete measured variables") from None
    if value is None:
        raise ValueError("missing weather cannot be replaced by a constant")
    return finite(float(value), key)


class OpenMeteoForecastClient:
    name = "open-meteo"

    def __init__(self, timeout: float = 15.0) -> None:
        self.timeout = timeout

    async def daily(self, lat: float, lon: float, days: int = 14) -> DailyForecast:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                BASE_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max,shortwave_radiation_sum",
                    "forecast_days": min(days, 16),
                    "timezone": "auto",
                    "wind_speed_unit": "kmh",
                },
            )
            response.raise_for_status()
            payload = response.json()

        daily = payload["daily"]
        out = [
            DailyWeather(
                date=Date.fromisoformat(daily["time"][i]),
                tmax_c=_required(daily, "temperature_2m_max", i),
                tmin_c=_required(daily, "temperature_2m_min", i),
                precipitation_mm=_required(daily, "precipitation_sum", i),
                humidity_pct=_required(daily, "relative_humidity_2m_mean", i),
                wind_kmh=_required(daily, "wind_speed_10m_max", i),
                solar_wh_m2=_required(daily, "shortwave_radiation_sum", i) / 0.0036,
            )
            for i in range(len(daily["time"]))
        ]

        return DailyForecast(
            days=out[:days],
            provenance=Provenance(
                source="Open-Meteo forecast",
                live=True,
                note="Substitute forecast provider. This is not Syngenta CE Hub data.",
                substituted_for="cehub",
            ),
        )

    async def hourly(self, lat: float, lon: float, hours: int = 336) -> HourlyForecast:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                BASE_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "hourly": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,shortwave_radiation",
                    "forecast_days": min(max(hours // 24, 1), 16),
                    "timezone": "auto",
                    "wind_speed_unit": "kmh",
                },
            )
            response.raise_for_status()
            payload = response.json()

        hourly = payload["hourly"]
        out = [
            HourlyWeather(
                timestamp=datetime.fromisoformat(hourly["time"][i]).replace(
                    tzinfo=timezone(timedelta(seconds=payload["utc_offset_seconds"]))).astimezone(UTC),
                temperature_c=_required(hourly, "temperature_2m", i),
                humidity_pct=_required(hourly, "relative_humidity_2m", i),
                wind_kmh=_required(hourly, "wind_speed_10m", i),
                precipitation_mm=_required(hourly, "precipitation", i + 1),
                solar_wh_m2=_required(hourly, "shortwave_radiation", i + 1),
            )
            for i in range(max(0, len(hourly["time"]) - 1))
        ]

        return HourlyForecast(
            hours=out[:hours],
            provenance=Provenance(
                source="Open-Meteo forecast",
                live=True,
                note="Substitute forecast provider. This is not Syngenta CE Hub data.",
                substituted_for="cehub",
            ),
        )
