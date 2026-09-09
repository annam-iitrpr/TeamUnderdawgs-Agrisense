"""Agronomic constants extracted from docs/algorithm_logic.pdf.

Every value below carries the page of the source document it came from. Nothing
here is invented. Where the source document does not state a value, the constant
is marked SOURCE: NOT IN DOCUMENT and is listed in docs/OPEN_QUESTIONS.md.

This module has no framework imports on purpose. An agronomist should be able to
read it without knowing any Python web stack.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

PHOSPHORUS_SF_DIVISOR: float = 4.0  # Source reproduction; /3 is an unapproved candidate.

YIELD_RISK_NORMALISE: bool = True

NIGHT_STRESS_USE_DAYTIME_EXAMPLE: bool = False

DROUGHT_INDEX_SURFACE_PERCENTILE: bool = True

STRESS_ONSET_THRESHOLD: float = 4.0


class Crop(StrEnum):
    """Crops named in the source document. India scope is rice, wheat and cotton."""

    RICE = "rice"
    WHEAT = "wheat"
    COTTON = "cotton"
    SOYBEAN = "soybean"
    CORN = "corn"


INDIA_CROPS: frozenset[Crop] = frozenset({Crop.RICE, Crop.WHEAT, Crop.COTTON})


class ProductKind(StrEnum):
    STRESS_BUSTER = "stress_buster"
    YIELD_BOOSTER = "yield_booster"


@dataclass(frozen=True)
class CardinalTemperatures:
    """Cardinal temperatures in degrees Celsius.

    tmin_no_frost and tmin_frost are None where the document records NA.
    """

    tmax_optimum: float
    tmax_limit: float
    tmin_optimum: float
    tmin_limit: float
    tmin_no_frost: float | None
    tmin_frost: float | None


CARDINALS: dict[Crop, CardinalTemperatures] = {
    Crop.SOYBEAN: CardinalTemperatures(32.0, 45.0, 22.0, 28.0, 4.0, -3.0),
    Crop.CORN: CardinalTemperatures(33.0, 44.0, 22.0, 28.0, 4.0, -3.0),
    Crop.COTTON: CardinalTemperatures(32.0, 38.0, 20.0, 25.0, 4.0, -3.0),
    Crop.RICE: CardinalTemperatures(32.0, 38.0, 22.0, 28.0, None, None),
    Crop.WHEAT: CardinalTemperatures(25.0, 32.0, 15.0, 20.0, None, None),
}

FROST_TRIGGER_TMIN_C: float = 4.0

STRESS_SCALE_MAX: float = 9.0


@dataclass(frozen=True)
class Range:
    """An inclusive optimal range as printed in the source tables."""

    low: float
    high: float

    @property
    def mid(self) -> float:
        return (self.low + self.high) / 2.0

    @property
    def span(self) -> float:
        """Width of the range, floored so normalisation can never divide by zero."""
        return max(self.high - self.low, 1e-09)

    def contains(self, value: float) -> bool:
        return self.low <= value <= self.high

    def deviation(self, value: float) -> float:
        """Distance outside the range. Zero when the value sits inside it."""
        if value < self.low:
            return self.low - value
        if value > self.high:
            return value - self.high
        return 0.0


@dataclass(frozen=True)
class YieldRiskOptima:
    """Optimal ranges used by the yield risk equation, page 6 table."""

    gdd: Range
    precipitation_mm: Range
    ph: Range
    nitrogen_g_per_kg: Range


YIELD_OPTIMA: dict[Crop, YieldRiskOptima] = {
    Crop.SOYBEAN: YieldRiskOptima(
        Range(2400, 3000), Range(450, 700), Range(6.0, 6.8), Range(0.0, 0.026)
    ),
    Crop.CORN: YieldRiskOptima(
        Range(2700, 3100), Range(500, 800), Range(6.0, 6.8), Range(0.077, 0.154)
    ),
    Crop.COTTON: YieldRiskOptima(
        Range(2200, 2600), Range(700, 1300), Range(6.0, 6.5), Range(0.051, 0.092)
    ),
    Crop.RICE: YieldRiskOptima(
        Range(2000, 2500), Range(1000, 1500), Range(5.5, 6.5), Range(0.051, 0.103)
    ),
    Crop.WHEAT: YieldRiskOptima(
        Range(2000, 2500), Range(1000, 1500), Range(5.5, 6.5), Range(0.051, 0.103)
    ),
}

YIELD_RISK_WEIGHTS: dict[str, float] = {
    "gdd": 0.3,
    "precipitation": 0.3,
    "ph": 0.2,
    "nitrogen": 0.2,
}

SOIL_MOISTURE_OPTIMA: dict[Crop, Range] = {
    Crop.SOYBEAN: Range(50.0, 70.0),
    Crop.CORN: Range(50.0, 70.0),
    Crop.COTTON: Range(50.0, 70.0),
    Crop.RICE: Range(80.0, 80.0),
    Crop.WHEAT: Range(80.0, 80.0),
}

PHOSPHORUS_PH_OPTIMA: dict[Crop, Range] = {
    Crop.SOYBEAN: Range(6.0, 7.0),
    Crop.CORN: Range(6.0, 7.0),
    Crop.COTTON: Range(6.0, 6.5),
    Crop.RICE: Range(5.5, 6.5),
    Crop.WHEAT: Range(6.0, 7.0),
}

NITROGEN_NUE_HIGH: float = 40.0

NITROGEN_NUE_MODERATE: float = 20.0

PHOSPHORUS_NUE_MODERATE: float = 0.05

PHOSPHORUS_NUE_GOOD: float = 0.1

PHOSPHORUS_NUE_EXCELLENT: float = 0.15

GDD_BASE_TEMPERATURE_C: dict[Crop, float] = {
    Crop.WHEAT: 0.0,
    Crop.RICE: 10.0,
    Crop.COTTON: 15.6,
    Crop.CORN: 10.0,
    Crop.SOYBEAN: 10.0,
}


@dataclass(frozen=True)
class GrowthStage:
    """A phenological stage bounded by accumulated GDD since sowing."""

    name: str
    gdd_start: float
    gdd_end: float
    is_vegetative: bool
    is_reproductive: bool


GROWTH_STAGES: dict[Crop, tuple[GrowthStage, ...]] = {
    Crop.RICE: (
        GrowthStage("establishment", 0, 350, True, False),
        GrowthStage("tillering", 350, 900, True, False),
        GrowthStage("panicle_initiation", 900, 1400, True, True),
        GrowthStage("heading", 1400, 1800, False, True),
        GrowthStage("grain_fill", 1800, 2250, False, True),
        GrowthStage("maturity", 2250, 10000, False, False),
    ),
    Crop.WHEAT: (
        GrowthStage("establishment", 0, 300, True, False),
        GrowthStage("tillering", 300, 800, True, False),
        GrowthStage("jointing", 800, 1300, True, True),
        GrowthStage("heading", 1300, 1700, False, True),
        GrowthStage("grain_fill", 1700, 2250, False, True),
        GrowthStage("maturity", 2250, 10000, False, False),
    ),
    Crop.COTTON: (
        GrowthStage("establishment", 0, 300, True, False),
        GrowthStage("vegetative", 300, 700, True, False),
        GrowthStage("match_head_square", 700, 1100, True, True),
        GrowthStage("flowering", 1100, 1700, False, True),
        GrowthStage("boll_fill", 1700, 2300, False, True),
        GrowthStage("maturity", 2300, 10000, False, False),
    ),
}

YIELD_BOOSTER_STAGES: dict[Crop, frozenset[str]] = {
    Crop.RICE: frozenset({"panicle_initiation", "heading"}),
    Crop.WHEAT: frozenset({"jointing", "heading"}),
    Crop.COTTON: frozenset({"match_head_square", "flowering"}),
}

DELTA_T_IDEAL = Range(2.0, 8.0)

DELTA_T_REJECT_ABOVE: float = 10.0

WIND_IDEAL = Range(3.0, 15.0)

WIND_REJECT_BELOW: float = 3.0

WIND_REJECT_ABOVE: float = 15.0

RAIN_FREE_HOURS_REQUIRED: int = 4

PRIMING_LEAD_DAYS = Range(3.0, 5.0)

FORECAST_HORIZON_DAYS: int = 14

GROSS_MARGIN_PER_HA: dict[Crop, float] = {
    Crop.RICE: 62000.0,
    Crop.WHEAT: 55000.0,
    Crop.COTTON: 78000.0,
    Crop.SOYBEAN: 48000.0,
    Crop.CORN: 52000.0,
}

YIELD_PROTECTION_PER_STRESS_DAY: float = 0.01

VALUE_ESTIMATE_BAND: float = 0.35

HECTARES_PER_ACRE: float = 0.404686
