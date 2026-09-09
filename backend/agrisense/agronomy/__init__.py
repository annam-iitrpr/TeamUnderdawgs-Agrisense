"""The deterministic agronomy core.

This package holds every agronomic decision AgriSense makes. It imports nothing
from the rest of the application and no web framework, so it can be unit tested
and read on its own. A language model never touches anything in here.
"""

from .constants import CARDINALS, Crop, ProductKind
from .projection import StressProjection, project_stress
from .scoring import Readiness, ValueEstimate, estimate_value, readiness
from .stress import (
    accumulate_gdd,
    drought_index_percentile,
    drought_index_raw,
    frost_stress,
    growing_degree_days,
    heat_stress_diurnal,
    heat_stress_nocturnal,
    nitrogen_use_efficiency,
    phosphorus_use_efficiency,
    yield_risk,
)
from .timing import CandidateDays, priming_window, stage_for_gdd
from .types import DailyWeather, FieldContext, HourlyWeather
from .viability import RankedHours, delta_t, spray_viability, wet_bulb_stull

__all__ = [
    "CARDINALS",
    "CandidateDays",
    "Crop",
    "DailyWeather",
    "FieldContext",
    "HourlyWeather",
    "ProductKind",
    "RankedHours",
    "Readiness",
    "StressProjection",
    "ValueEstimate",
    "accumulate_gdd",
    "delta_t",
    "drought_index_percentile",
    "drought_index_raw",
    "estimate_value",
    "frost_stress",
    "growing_degree_days",
    "heat_stress_diurnal",
    "heat_stress_nocturnal",
    "nitrogen_use_efficiency",
    "phosphorus_use_efficiency",
    "priming_window",
    "project_stress",
    "readiness",
    "spray_viability",
    "stage_for_gdd",
    "wet_bulb_stull",
    "yield_risk",
]
