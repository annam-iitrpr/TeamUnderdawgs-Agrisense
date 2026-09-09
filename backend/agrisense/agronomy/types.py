"""Weather shapes the engine consumes.

Everything downstream of the data clients depends only on these two shapes. When a
provider's schema differs, one adapter changes and nothing else does.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class DailyWeather:
    date: Date
    tmax_c: float
    tmin_c: float
    precipitation_mm: float
    humidity_pct: float
    wind_kmh: float
    solar_wh_m2: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "tmax_c": self.tmax_c,
            "tmin_c": self.tmin_c,
            "precipitation_mm": self.precipitation_mm,
            "humidity_pct": self.humidity_pct,
            "wind_kmh": self.wind_kmh,
            "solar_wh_m2": self.solar_wh_m2,
        }


@dataclass(frozen=True)
class HourlyWeather:
    timestamp: datetime
    temperature_c: float
    humidity_pct: float
    wind_kmh: float
    precipitation_mm: float
    solar_wh_m2: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "temperature_c": self.temperature_c,
            "humidity_pct": self.humidity_pct,
            "wind_kmh": self.wind_kmh,
            "precipitation_mm": self.precipitation_mm,
            "solar_wh_m2": self.solar_wh_m2,
        }


@dataclass(frozen=True)
class FieldContext:
    """The field attributes the engine needs. Deliberately not a database row."""

    crop: str
    lat: float
    lon: float
    area_ha: float
    sowing_date: Date
    soil_ph: float
    soil_moisture_pct: float = 55.0
    nitrogen_g_per_kg: float = 0.06
