"""Source-table reproduction and separately named advisory diagnostics.

Constants transcribed from the supplied phase 2 specification; not field
calibration or product efficacy evidence. The source omits GDD base temperatures.
"""

from dataclasses import dataclass
from math import exp
from typing import Literal

from .units import clip, finite

Crop = Literal["soybean", "maize", "cotton", "rice", "wheat"]
CARDINALS = {
    "soybean": (32, 45, 22, 28, 4, -3),
    "maize": (33, 44, 22, 28, 4, -3),
    "cotton": (32, 38, 20, 25, 4, -3),
    "rice": (32, 38, 22, 28, None, None),
    "wheat": (25, 32, 15, 20, None, None),
}
OPTIMA = {
    "soybean": ((2400, 3000), (450, 700), (6, 6.8), (0, 0.026)),
    "maize": ((2700, 3100), (500, 800), (6, 6.8), (0.077, 0.154)),
    "cotton": ((2200, 2600), (700, 1300), (6, 6.5), (0.051, 0.092)),
    "rice": ((2000, 2500), (1000, 1500), (5.5, 6.5), (0.051, 0.103)),
    "wheat": ((2000, 2500), (1000, 1500), (5.5, 6.5), (0.051, 0.103)),
}


@dataclass(frozen=True)
class HeatStress:
    day: float | None
    night: float | None
    frost: float | None
    reasons: tuple[str, ...]


def heat_stress(crop: Crop, tmax: float | None, tmin: float | None) -> HeatStress:
    day_opt, day_limit, night_opt, night_limit, frost_opt, frost_limit = CARDINALS[crop]
    for value in (tmin, tmax):
        if value is not None:
            finite(value, "temperature", -90, 65)
    if tmin is not None and tmax is not None and tmin > tmax:
        raise ValueError("Tmin exceeds Tmax")
    day = None if tmax is None else 9 * clip((tmax - day_opt) / (day_limit - day_opt), 0, 1)
    night = None if tmin is None else 9 * clip((tmin - night_opt) / (night_limit - night_opt), 0, 1)
    frost = None
    reasons = []
    if frost_opt is None or frost_limit is None:
        reasons.append("frost_not_parameterized")
    elif tmin is not None:
        frost = 9 * clip((frost_opt - tmin) / (frost_opt - frost_limit), 0, 1)
    if tmin is None or tmax is None:
        reasons.append("missing_temperature")
    return HeatStress(day, night, frost, tuple(reasons))


def yield_risk(
    crop: Crop,
    values: tuple[float | None, ...],
    *,
    ruleset: Literal["reference_v1", "advisory_v1"] = "advisory_v1",
) -> dict:
    if len(values) != 4 or ruleset not in ("reference_v1", "advisory_v1"):
        raise ValueError("require GDD, seasonal rain, pH and N and a named ruleset")
    parts = []
    for value, (lo, hi), weight in zip(values, OPTIMA[crop], (0.3, 0.3, 0.2, 0.2)):
        if value is None:
            parts.append(None)
            continue
        finite(value, "risk input")
        if ruleset == "reference_v1":
            parts.append(weight * (value - (lo + hi) / 2) ** 2)
        else:
            distance = max(lo - value, value - hi, 0) / (hi - lo)
            parts.append(9 * weight * min(distance**2, 1))
    return {
        "score": None if None in parts else sum(parts),
        "components": parts,
        "coverage": sum(x is not None for x in parts) / 4,
        "ruleset": ruleset,
        "basis": "unvalidated_heuristic",
        "warnings": ["source_optima_require_review", "not_yield_loss"],
    }


def growing_degree_days(tmin: float, tmax: float, base: float, cap: float | None = None) -> float:
    for value in (tmin, tmax, base):
        finite(value, "temperature", -90, 65)
    if tmin > tmax:
        raise ValueError("Tmin exceeds Tmax")
    if cap is not None:
        finite(cap, "cap", base, 65)
        tmin, tmax = min(tmin, cap), min(tmax, cap)
    return max(0, (tmin + tmax) / 2 - base)


def vpd_kpa(temperature_c: float, rh_percent: float) -> float:
    finite(temperature_c, "temperature", -90, 65)
    finite(rh_percent, "RH", 0, 100)
    return 0.6108 * exp(17.27 * temperature_c / (temperature_c + 237.3)) * (1 - rh_percent / 100)


def source_drought_index(
    rain: float, evap: float, moisture: float, temperature: float, *, parse: str
) -> dict:
    for value in (rain, evap, moisture, temperature):
        finite(value, "source DI input")
    if parse not in ("P-E+SM/T", "(P-E+SM)/T"):
        raise ValueError("name the ambiguous source parse")
    value = (
        None
        if temperature == 0
        else (
            rain - evap + moisture / temperature
            if parse == "P-E+SM/T"
            else (rain - evap + moisture) / temperature
        )
    )
    return {
        "value": value,
        "parse": parse,
        "valid_for_advisory": False,
        "warnings": ["incompatible_units", "ambiguous_moisture_basis"],
    }


def nitrogen_reference(
    yield_kg_ha: float, applied_n_kg_ha: float, rain_factor: float, moisture_factor: float
) -> dict:
    for value in (yield_kg_ha, applied_n_kg_ha, rain_factor, moisture_factor):
        finite(value, "nitrogen input", 0)
    index = (
        None
        if applied_n_kg_ha == 0
        else yield_kg_ha / applied_n_kg_ha * rain_factor * moisture_factor
    )
    return {
        "index": index,
        "basis": "partial_factor_productivity_reference",
        "is_deficiency_diagnosis": False,
    }


def phosphorus_reference(
    yield_t_ha: float,
    applied_p_kg_ha: float,
    factors: tuple[float, float, float],
    *,
    divisor: int = 4,
) -> dict:
    finite(yield_t_ha, "yield", 0)
    finite(applied_p_kg_ha, "elemental P", 0)
    if divisor not in (3, 4):
        raise ValueError("only source /4 and explicit candidate /3 are supported")
    for factor in factors:
        finite(factor, "factor", 0, 1)
    index = None if applied_p_kg_ha == 0 else yield_t_ha / applied_p_kg_ha * sum(factors) / divisor
    # Boundary convention: each upper bound is included in the lower category.
    category = (
        None
        if index is None
        else (
            "low"
            if index <= 0.05
            else "moderate"
            if index <= 0.10
            else "high"
            if index <= 0.15
            else "very_high"
        )
    )
    return {
        "index": index,
        "category": category,
        "divisor": divisor,
        "ruleset": "reference_v1" if divisor == 4 else "candidate_divide_by_three",
        "valid_for_prescription": False,
    }
