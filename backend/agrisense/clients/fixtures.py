"""Fixture backed forecast client. Always works, never touches the network.

The fixtures are generated deterministically per field so that every demo run tells
the same story, including the Amravati field where the honest answer is that there
is no viable window at all.
"""

from __future__ import annotations

import json
from datetime import date as Date
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from agrisense.agronomy.types import DailyWeather, HourlyWeather

from .base import DailyForecast, HourlyForecast, Provenance

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures"


def _nearest_fixture(lat: float, lon: float) -> dict[str, Any]:
    """Pick the bundled field whose coordinates are closest to the request.

    A field the demo has never seen still gets a plausible forecast rather than an
    empty screen, which is what keeps the cold start path working.
    """
    fixtures = sorted(FIXTURE_DIR.glob("forecast_*.json"))
    if not fixtures:
        raise FileNotFoundError("No bundled forecast fixtures found")

    best = None
    best_distance = float("inf")
    for path in fixtures:
        data = json.loads(path.read_text())
        distance = (data["lat"] - lat) ** 2 + (data["lon"] - lon) ** 2
        if distance < best_distance:
            best, best_distance = data, distance

    assert best is not None
    return best


def _rebase_dates(days_offset: int, iso: str) -> datetime:
    """Shift a stored timestamp so fixtures always look like today onward."""
    return datetime.fromisoformat(iso) + timedelta(days=days_offset)


class FixtureForecastClient:
    name = "fixture"

    async def daily(self, lat: float, lon: float, days: int = 14) -> DailyForecast:
        data = _nearest_fixture(lat, lon)
        anchor = Date.fromisoformat(data["daily"][0]["date"])
        offset = (Date.today() - anchor).days

        out = [
            DailyWeather(
                date=Date.fromisoformat(row["date"]) + timedelta(days=offset),
                tmax_c=row["tmax_c"],
                tmin_c=row["tmin_c"],
                precipitation_mm=row["precipitation_mm"],
                humidity_pct=row["humidity_pct"],
                wind_kmh=row["wind_kmh"],
                solar_wh_m2=row["solar_wh_m2"],
            )
            for row in data["daily"]
        ]

        return DailyForecast(
            days=out[:days],
            provenance=Provenance(
                source=f"Bundled fixture, {data['name']}",
                live=False,
                note="Demo data. No network call was made.",
            ),
        )

    async def hourly(self, lat: float, lon: float, hours: int = 336) -> HourlyForecast:
        data = _nearest_fixture(lat, lon)
        anchor = datetime.fromisoformat(data["hourly"][0]["timestamp"]).date()
        offset = (Date.today() - anchor).days

        out = [
            HourlyWeather(
                timestamp=_rebase_dates(offset, row["timestamp"]),
                temperature_c=row["temperature_c"],
                humidity_pct=row["humidity_pct"],
                wind_kmh=row["wind_kmh"],
                precipitation_mm=row["precipitation_mm"],
                solar_wh_m2=row["solar_wh_m2"],
            )
            for row in data["hourly"]
        ]

        return HourlyForecast(
            hours=out[:hours],
            provenance=Provenance(
                source=f"Bundled fixture, {data['name']}",
                live=False,
                note="Demo data. No network call was made.",
            ),
        )
