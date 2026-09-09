"""The five stress algorithms, GDD, and the two nutrient use efficiency functions.

Each function follows the equations in docs/algorithm_logic.pdf literally and
returns a StressResult carrying both the value and the inputs that produced it,
so that any output can be reconstructed months later from stored JSON.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .constants import (
    CARDINALS,
    FROST_TRIGGER_TMIN_C,
    GDD_BASE_TEMPERATURE_C,
    NIGHT_STRESS_USE_DAYTIME_EXAMPLE,
    NITROGEN_NUE_HIGH,
    NITROGEN_NUE_MODERATE,
    PHOSPHORUS_NUE_EXCELLENT,
    PHOSPHORUS_NUE_GOOD,
    PHOSPHORUS_NUE_MODERATE,
    PHOSPHORUS_PH_OPTIMA,
    PHOSPHORUS_SF_DIVISOR,
    SOIL_MOISTURE_OPTIMA,
    STRESS_SCALE_MAX,
    YIELD_OPTIMA,
    YIELD_RISK_NORMALISE,
    YIELD_RISK_WEIGHTS,
    Crop,
    Range,
)


@dataclass(frozen=True)
class StressResult:
    """A single stress score plus the exact inputs that produced it.

    value is None only where the source document records the stress as not
    applicable for the crop. None must never be rendered as zero risk.
    """

    stress_type: str
    value: float | None
    inputs: dict[str, Any] = field(default_factory=dict)
    note: str | None = None
    applicable: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "stress_type": self.stress_type,
            "value": self.value,
            "inputs": self.inputs,
            "note": self.note,
            "applicable": self.applicable,
        }


def _ramp(value: float, low: float, high: float) -> float:
    if value <= low:
        return 0.0
    if value >= high:
        return STRESS_SCALE_MAX
    return STRESS_SCALE_MAX * (value - low) / (high - low)


def heat_stress_diurnal(tmax: float, crop: Crop) -> StressResult:
    c = CARDINALS[crop]
    value = _ramp(tmax, c.tmax_optimum, c.tmax_limit)
    return StressResult(
        "heat_diurnal",
        round(value, 4),
        inputs={
            "tmax": tmax,
            "tmax_optimum": c.tmax_optimum,
            "tmax_limit": c.tmax_limit,
            "crop": crop.value,
        },
    )


def heat_stress_nocturnal(tmin: float, crop: Crop) -> StressResult:
    c = CARDINALS[crop]
    if NIGHT_STRESS_USE_DAYTIME_EXAMPLE:
        low, high, driver = c.tmax_optimum, c.tmax_limit, "tmax_constants"
    else:
        low, high, driver = c.tmin_optimum, c.tmin_limit, "tmin_constants"
    value = min(_ramp(tmin, low, high), STRESS_SCALE_MAX)
    return StressResult(
        "heat_nocturnal",
        round(value, 4),
        inputs={
            "tmin": tmin,
            "tmin_optimum": low,
            "tmin_limit": high,
            "crop": crop.value,
            "constants_used": driver,
        },
    )


def frost_stress(tmin: float, crop: Crop) -> StressResult:
    c = CARDINALS[crop]
    if c.tmin_no_frost is None and c.tmin_frost is None:
        return StressResult(
            "frost",
            None,
            inputs={"tmin": tmin, "crop": crop.value},
            note="Not parameterized in the source; this does not mean the crop cannot suffer frost.",
            applicable=False,
        )
    if tmin > FROST_TRIGGER_TMIN_C:
        value = 0.0
    else:
        denominator = abs(c.tmin_frost - c.tmin_no_frost)
        value = min(STRESS_SCALE_MAX * abs(tmin - c.tmin_no_frost) / denominator, STRESS_SCALE_MAX)
    return StressResult(
        "frost",
        round(value, 4),
        inputs={
            "tmin": tmin,
            "tmin_no_frost": c.tmin_no_frost,
            "tmin_frost": c.tmin_frost,
            "crop": crop.value,
        },
    )


def growing_degree_days(tmax: float, tmin: float, crop: Crop) -> float:
    tbase = GDD_BASE_TEMPERATURE_C[crop]
    return max((tmax + tmin) / 2.0 - tbase, 0.0)


def accumulate_gdd(daily: list[tuple[float, float]], crop: Crop) -> float:
    return sum(growing_degree_days(tmax, tmin, crop) for tmax, tmin in daily)


def drought_index_raw(
    precipitation_mm: float,
    evaporation_mm: float,
    soil_moisture: float,
    mean_temperature_c: float,
) -> StressResult:
    if mean_temperature_c == 0:
        return StressResult(
            "drought_raw", None, inputs={"mean_temperature_c": 0},
            note="Undefined at zero temperature; dimensional ambiguity makes this reference-only.",
            applicable=False,
        )
    value = precipitation_mm - evaporation_mm + soil_moisture / mean_temperature_c
    return StressResult(
        "drought_raw",
        round(value, 4),
        inputs={
            "precipitation_mm": precipitation_mm,
            "evaporation_mm": evaporation_mm,
            "soil_moisture": soil_moisture,
            "mean_temperature_c": mean_temperature_c,
        },
        note="Raw index. Unnormalised, so magnitude scales with window length.",
    )


def drought_index_percentile(raw_value: float, history: list[float]) -> StressResult:
    if not history:
        return StressResult(
            "drought",
            None,
            inputs={"raw": raw_value, "history_n": 0},
            note="No comparable history available for this location and window.",
            applicable=False,
        )
    below = sum(1 for h in history if h < raw_value)
    percentile = below / len(history)
    value = STRESS_SCALE_MAX * (1.0 - percentile)
    return StressResult(
        "drought",
        round(value, 4),
        inputs={
            "raw": raw_value,
            "history_n": len(history),
            "percentile": round(percentile, 4),
        },
        note=f"Drier than {round((1 - percentile) * 100)} percent of comparable periods.",
    )


def yield_risk(
    gdd: float,
    precipitation_mm: float,
    ph: float,
    nitrogen_g_per_kg: float,
    crop: Crop,
) -> StressResult:
    optima = YIELD_OPTIMA[crop]
    w = YIELD_RISK_WEIGHTS
    terms = {
        "gdd": (optima.gdd, gdd, w["gdd"]),
        "precipitation": (optima.precipitation_mm, precipitation_mm, w["precipitation"]),
        "ph": (optima.ph, ph, w["ph"]),
        "nitrogen": (optima.nitrogen_g_per_kg, nitrogen_g_per_kg, w["nitrogen"]),
    }

    contributions: dict[str, float] = {}
    total = 0.0
    for name, (rng, actual, weight) in terms.items():
        deviation = rng.deviation(actual)
        if YIELD_RISK_NORMALISE:
            deviation = min(deviation / rng.span, 1.0)
        contribution = weight * deviation**2
        contributions[name] = round(contribution, 6)
        total += contribution

    if YIELD_RISK_NORMALISE:
        scaled = STRESS_SCALE_MAX * (total / sum(w.values()))
    else:
        scaled = total

    return StressResult(
        "yield_risk",
        round(scaled, 4),
        inputs={
            "gdd": gdd,
            "precipitation_mm": precipitation_mm,
            "ph": ph,
            "nitrogen_g_per_kg": nitrogen_g_per_kg,
            "crop": crop.value,
            "weights": w,
            "contributions": contributions,
            "normalised": YIELD_RISK_NORMALISE,
            "raw_total": round(total, 6),
        },
    )


def _factor(actual: float, optimal: Range) -> float:
    if optimal.contains(actual):
        return 1.0
    target = optimal.low if actual < optimal.low else optimal.high
    if target == 0:
        return 1.0
    return actual / target


def nitrogen_use_efficiency(
    crop_yield_kg_ha: float,
    nitrogen_applied_kg_ha: float,
    rainfall_mm: float,
    soil_moisture_pct: float,
    crop: Crop,
) -> StressResult:
    if nitrogen_applied_kg_ha <= 0:
        return StressResult(
            "nitrogen_nue",
            None,
            inputs={"nitrogen_applied_kg_ha": nitrogen_applied_kg_ha},
            note="No nitrogen applied, so use efficiency is undefined.",
            applicable=False,
        )

    rf = _factor(rainfall_mm, YIELD_OPTIMA[crop].precipitation_mm)
    smf = _factor(soil_moisture_pct, SOIL_MOISTURE_OPTIMA[crop])
    nue = crop_yield_kg_ha / nitrogen_applied_kg_ha * rf * smf

    if nue > NITROGEN_NUE_HIGH:
        band = "high"
    elif nue >= NITROGEN_NUE_MODERATE:
        band = "moderate"
    else:
        band = "low"

    return StressResult(
        "nitrogen_nue",
        round(nue, 4),
        inputs={
            "crop_yield_kg_ha": crop_yield_kg_ha,
            "nitrogen_applied_kg_ha": nitrogen_applied_kg_ha,
            "rainfall_factor": round(rf, 4),
            "soil_moisture_factor": round(smf, 4),
            "band": band,
            "recommend_biostimulant": False,
            "diagnostic_only": True,
        },
        note=f"{band.capitalize()} nitrogen use efficiency.",
    )


def phosphorus_use_efficiency(
    crop_yield_tonnes_ha: float,
    phosphorus_applied_kg_ha: float,
    ph: float,
    soil_moisture_pct: float,
    rainfall_mm: float,
    crop: Crop,
) -> StressResult:
    if phosphorus_applied_kg_ha <= 0:
        return StressResult(
            "phosphorus_nue",
            None,
            inputs={"phosphorus_applied_kg_ha": phosphorus_applied_kg_ha},
            note="No phosphorus applied, so use efficiency is undefined.",
            applicable=False,
        )

    phf = min(_factor(ph, PHOSPHORUS_PH_OPTIMA[crop]), 1.0)
    smf = min(_factor(soil_moisture_pct, SOIL_MOISTURE_OPTIMA[crop]), 1.0)
    rff = min(_factor(rainfall_mm, YIELD_OPTIMA[crop].precipitation_mm), 1.0)
    sf = (phf + smf + rff) / PHOSPHORUS_SF_DIVISOR
    pue = crop_yield_tonnes_ha / phosphorus_applied_kg_ha * sf

    if pue > PHOSPHORUS_NUE_EXCELLENT:
        band = "excellent"
    elif pue >= PHOSPHORUS_NUE_GOOD:
        band = "good"
    elif pue >= PHOSPHORUS_NUE_MODERATE:
        band = "moderate"
    else:
        band = "low"

    return StressResult(
        "phosphorus_nue",
        round(pue, 4),
        inputs={
            "crop_yield_tonnes_ha": crop_yield_tonnes_ha,
            "phosphorus_applied_kg_ha": phosphorus_applied_kg_ha,
            "ph_factor": round(phf, 4),
            "soil_moisture_factor": round(smf, 4),
            "rainfall_factor": round(rff, 4),
            "soil_factor": round(sf, 4),
            "sf_divisor": PHOSPHORUS_SF_DIVISOR,
            "band": band,
            "recommend_biostimulant": False,
            "diagnostic_only": True,
        },
        note=f"{band.capitalize()} phosphorus use efficiency.",
    )
