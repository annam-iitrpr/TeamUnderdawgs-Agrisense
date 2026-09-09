"""Layer 1: run the stress equations forward across the forecast horizon.

The source document scores stress from yesterday's weather, which is a diagnosis.
Running the identical equations across the forward forecast turns the same maths
into a warning with enough lead time to act on.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as Date
from typing import Any

from .constants import STRESS_ONSET_THRESHOLD, Crop
from .stress import (
    accumulate_gdd,
    frost_stress,
    heat_stress_diurnal,
    heat_stress_nocturnal,
    yield_risk,
)
from .types import DailyWeather, FieldContext


@dataclass(frozen=True)
class DayStress:
    """Every stress score for a single forecast day."""

    date: Date
    scores: dict[str, float | None]
    inputs: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "scores": self.scores,
            "inputs": self.inputs,
        }


@dataclass(frozen=True)
class Onset:
    """The first day a stress type crosses the onset threshold."""

    stress_type: str
    date: Date
    value: float
    threshold: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "stress_type": self.stress_type,
            "date": self.date.isoformat(),
            "value": self.value,
            "threshold": self.threshold,
        }


DAILY_STRESS_TYPES: tuple[str, ...] = ("heat_diurnal", "heat_nocturnal", "frost", "drought")


@dataclass(frozen=True)
class StressProjection:
    """Per day, per stress type curves plus the first onset of each stress type."""

    crop: Crop
    days: list[DayStress]
    onsets: dict[str, Onset]
    accumulated_gdd: float
    season_yield_risk: float | None = None
    season_yield_risk_inputs: dict[str, Any] = field(default_factory=dict)
    not_applicable: list[str] = field(default_factory=list)

    @property
    def earliest_onset(self) -> Onset | None:
        if not self.onsets:
            return None
        return min(self.onsets.values(), key=lambda o: o.date)

    def peak(self, stress_type: str) -> float:
        values = [d.scores.get(stress_type) for d in self.days if d.scores.get(stress_type) is not None]
        return max((v for v in values if v is not None), default=0.0)

    def curve(self, stress_type: str) -> list[float | None]:
        return [d.scores.get(stress_type) for d in self.days]

    def as_dict(self) -> dict[str, Any]:
        return {
            "crop": self.crop.value,
            "days": [d.as_dict() for d in self.days],
            "onsets": {k: v.as_dict() for k, v in self.onsets.items()},
            "accumulated_gdd": self.accumulated_gdd,
            "season_yield_risk": self.season_yield_risk,
            "season_yield_risk_inputs": self.season_yield_risk_inputs,
            "not_applicable": self.not_applicable,
        }


def project_stress(
    field_ctx: FieldContext,
    forecast: list[DailyWeather],
    history_drought: list[float] | None = None,
    onset_threshold: float = STRESS_ONSET_THRESHOLD,
    gdd_since_sowing: float | None = None,
    season_precipitation_mm: float | None = None,
) -> StressProjection:
    crop = Crop(field_ctx.crop)
    days: list[DayStress] = []
    onsets: dict[str, Onset] = {}
    not_applicable: list[str] = []

    forecast_days = [(d.tmax_c, d.tmin_c) for d in forecast]
    accumulated = accumulate_gdd(forecast_days, crop)

    # The supplied DI combines incompatible units and unspecified moisture.
    # Never transform it into an advisory drought score; science.water supplies
    # the explicit root-zone balance when its required inputs are available.
    not_applicable.append("drought")

    season_yield_risk: float | None = None
    season_yield_risk_inputs: dict[str, Any] = {}

    if gdd_since_sowing is not None and season_precipitation_mm is not None:
        yr = yield_risk(
            gdd_since_sowing,
            season_precipitation_mm,
            field_ctx.soil_ph,
            field_ctx.nitrogen_g_per_kg,
            crop,
        )
        season_yield_risk = yr.value
        season_yield_risk_inputs = yr.inputs
    else:
        not_applicable.append("yield_risk")
        season_yield_risk_inputs = {
            "note": "Not computed. Season to date GDD and rainfall were not supplied."
        }

    for day in forecast:
        diurnal = heat_stress_diurnal(day.tmax_c, crop)
        nocturnal = heat_stress_nocturnal(day.tmin_c, crop)
        frost = frost_stress(day.tmin_c, crop)

        scores = {
            "heat_diurnal": diurnal.value,
            "heat_nocturnal": nocturnal.value,
            "frost": frost.value,
            "drought": None,
        }

        days.append(
            DayStress(
                day.date,
                scores,
                inputs={
                    "weather": day.as_dict(),
                    "heat_diurnal": diurnal.inputs,
                    "heat_nocturnal": nocturnal.inputs,
                    "frost": frost.inputs,
                },
            )
        )

        if not frost.applicable and "frost" not in not_applicable:
            not_applicable.append("frost")

        for stress_type, value in scores.items():
            if value is None or stress_type in onsets:
                continue
            if value >= onset_threshold:
                onsets[stress_type] = Onset(stress_type, day.date, value, onset_threshold)

    return StressProjection(
        crop,
        days,
        onsets,
        round(accumulated, 2),
        season_yield_risk=season_yield_risk,
        season_yield_risk_inputs=season_yield_risk_inputs,
        not_applicable=not_applicable,
    )
