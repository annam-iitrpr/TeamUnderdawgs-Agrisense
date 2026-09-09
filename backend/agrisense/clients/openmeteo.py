"""Open-Meteo forecast client. Needs no key at all.

Used as the live substitute when CE Hub is unreachable, so the demo can still show
real current weather. Its provenance is always labelled as a substitute so nobody
mistakes it for the Syngenta service.
"""

from __future__ import annotations

from datetime import date as Date
from datetime import datetime

import httpx

from agrisense.agronomy.types import DailyWeather, HourlyWeather

from .base import DailyForecast, HourlyForecast, Provenance

BASE_URL = "https://api.open-meteo.com/v1/forecast"


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
                    "daily": ",".join(
                        [
                            "temperature_2m_max",
                            "temperature_2m_min",
                            "precipitation_sum",
                            "relative_humidity_2m_mean",
                            "wind_speed_10m_max",
                            "shortwave_radiation_sum",
                        ]
                    ),
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
                tmax_c=daily["temperature_2m_max"][i],
                tmin_c=daily["temperature_2m_min"][i],
                precipitation_mm=daily["precipitation_sum"][i] or 0.0,
                humidity_pct=daily.get("relative_humidity_2m_mean", [60.0] * 20)[i] or 60.0,
                wind_kmh=daily["wind_speed_10m_max"][i] or 5.0,
                solar_wh_m2=(daily["shortwave_radiation_sum"][i] or 18.0) * 277.78,
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
                    "hourly": ",".join(
                        [
                            "temperature_2m",
                            "relative_humidity_2m",
                            "precipitation",
                            "wind_speed_10m",
                            "shortwave_radiation",
                        ]
                    ),
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
                timestamp=datetime.fromisoformat(hourly["time"][i]),
                temperature_c=hourly["temperature_2m"][i],
                humidity_pct=hourly["relative_humidity_2m"][i],
                wind_kmh=hourly["wind_speed_10m"][i] or 0.0,
                precipitation_mm=hourly["precipitation"][i] or 0.0,
                solar_wh_m2=hourly["shortwave_radiation"][i] or 0.0,
            )
            for i in range(len(hourly["time"]))
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
