"""Shadow-only forecast bias models from archived vintages and QC observations."""

from dataclasses import dataclass
from datetime import datetime

import numpy as np

from .units import finite
from .weather import utc


@dataclass(frozen=True)
class WeatherPair:
    forecast_issue_at: datetime
    valid_at: datetime
    observation_available_at: datetime
    forecast_value: float
    observed_value: float
    variable: str
    station_id: str
    qc_passed: bool
    representative: bool

    def __post_init__(self) -> None:
        if (
            not utc(self.forecast_issue_at)
            <= utc(self.valid_at)
            <= utc(self.observation_available_at)
        ):
            raise ValueError("invalid forecast vintage/observation chronology")
        finite(self.forecast_value, "forecast value")
        finite(self.observed_value, "observation")
        if (
            self.variable not in ("temperature_c", "wind_kmh", "rain_mm", "rh_percent")
            or not self.station_id
        ):
            raise ValueError("explicit supported variable and station required")


def fit_bias(
    pairs: tuple[WeatherPair, ...],
    *,
    cutoff: datetime,
    variable: str,
    lead_min_hours: float,
    lead_max_hours: float,
    max_abs_offset: float,
) -> dict:
    finite(lead_min_hours, "minimum lead", 0)
    finite(lead_max_hours, "maximum lead", lead_min_hours)
    finite(max_abs_offset, "reviewed maximum offset", 0)
    selected = []
    identities = set()
    for pair in pairs:
        if utc(pair.observation_available_at) >= utc(cutoff):
            raise ValueError("held-out or not-yet-available observation in training input")
        identity = (pair.station_id, utc(pair.forecast_issue_at), utc(pair.valid_at), pair.variable)
        if identity in identities:
            raise ValueError("duplicate forecast-observation pair")
        identities.add(identity)
        lead = (utc(pair.valid_at) - utc(pair.forecast_issue_at)).total_seconds() / 3600
        if (
            pair.qc_passed
            and pair.representative
            and pair.variable == variable
            and lead_min_hours <= lead <= lead_max_hours
        ):
            selected.append(pair)
    if not selected:
        return {
            "offset": None,
            "reason": "representative_qc_paired_forecasts_required",
            "status": "unavailable",
        }
    raw = float(np.mean([pair.observed_value - pair.forecast_value for pair in selected]))
    offset = min(max(raw, -max_abs_offset), max_abs_offset)
    forecasts = np.array([pair.forecast_value for pair in selected])
    observations = np.array([pair.observed_value for pair in selected])
    return {
        "offset": offset,
        "raw_offset": raw,
        "variable": variable,
        "sample_count": len(selected),
        "lead_min_hours": lead_min_hours,
        "lead_max_hours": lead_max_hours,
        "status": "shadow_candidate",
        "forecast_knots": np.quantile(forecasts, np.linspace(0, 1, 11)).tolist(),
        "observation_knots": np.quantile(observations, np.linspace(0, 1, 11)).tolist(),
        "warnings": [
            "not_promoted",
            "station_representativeness_requires_review",
            "no_tail_extrapolation",
        ],
    }


def apply_bias(value: float, candidate: dict, *, method: str = "mean") -> float | None:
    finite(value, "forecast input")
    if candidate.get("offset") is None:
        return None
    variable = candidate["variable"]
    if method == "mean":
        corrected = value + candidate["offset"]
    elif method == "quantile_mapping":
        x, y = candidate["forecast_knots"], candidate["observation_knots"]
        if value < min(x) or value > max(x):
            return None
        if variable == "rain_mm" and value == 0:
            return 0.0
        # Duplicate forecast quantiles do not identify a unique mapping.
        if len(set(x)) != len(x):
            return None
        corrected = float(np.interp(value, x, y))
    else:
        raise ValueError("unrecognized bias correction method")
    if variable in ("rain_mm", "wind_kmh"):
        return max(0, corrected)
    if variable == "rh_percent":
        return min(100, max(0, corrected))
    return corrected
