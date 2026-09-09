"""The composite readiness score and the indicative value estimate.

readiness = need x timing_fit x viability

The score is explainable because it is built from three separately meaningful
components, not because something narrates it afterwards. All three are always
returned alongside the product so a user can see which one is holding the score
down.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as Date
from typing import Any

from .constants import GROSS_MARGIN_PER_HA, STRESS_SCALE_MAX, VALUE_ESTIMATE_BAND, YIELD_PROTECTION_PER_STRESS_DAY, Crop, ProductKind
from .projection import DAILY_STRESS_TYPES, StressProjection
from .timing import CandidateDays
from .viability import RankedHours, SprayWindow


@dataclass(frozen=True)
class ValueEstimate:
    """An indicative rupee range. Never present this as a measured result."""

    low_inr: int
    high_inr: int
    per_acre_low_inr: int
    per_acre_high_inr: int
    basis: str
    delay_days: int
    stress_days: float
    area_ha: float
    label: str = "model estimate"

    def as_dict(self) -> dict[str, Any]:
        return {
            "low_inr": self.low_inr,
            "high_inr": self.high_inr,
            "per_acre_low_inr": self.per_acre_low_inr,
            "per_acre_high_inr": self.per_acre_high_inr,
            "basis": self.basis,
            "delay_days": self.delay_days,
            "stress_days": self.stress_days,
            "area_ha": self.area_ha,
            "label": self.label,
        }


@dataclass(frozen=True)
class Readiness:
    """The full decomposed result. This is what the API returns and the UI renders."""

    readiness_score: int
    need: float
    timing_fit: float
    viability: float
    driving_stress: str | None
    window: SprayWindow | None
    candidate_day: Date | None
    stage: str
    product_kind: ProductKind
    value_estimate: ValueEstimate | None
    blocked_reason: str | None = None
    check_again_on: Date | None = None
    factors: list[dict[str, Any]] = field(default_factory=list)

    @property
    def actionable(self) -> bool:
        return self.window is not None and self.blocked_reason is None

    def as_dict(self) -> dict[str, Any]:
        return {
            "readiness_score": self.readiness_score,
            "need": self.need,
            "timing_fit": self.timing_fit,
            "viability": self.viability,
            "driving_stress": self.driving_stress,
            "window": self.window.as_dict() if self.window else None,
            "candidate_day": self.candidate_day.isoformat() if self.candidate_day else None,
            "stage": self.stage,
            "product_kind": self.product_kind.value,
            "value_estimate": self.value_estimate.as_dict() if self.value_estimate else None,
            "blocked_reason": self.blocked_reason,
            "check_again_on": self.check_again_on.isoformat() if self.check_again_on else None,
            "factors": self.factors,
            "actionable": self.actionable,
        }


def compute_need(projection: StressProjection) -> tuple[float, str | None]:
    peaks = {
        stress_type: projection.peak(stress_type)
        for stress_type in DAILY_STRESS_TYPES
        if stress_type not in projection.not_applicable
    }
    if projection.season_yield_risk is not None:
        peaks["yield_risk"] = projection.season_yield_risk

    peaks = {k: v for k, v in peaks.items() if v > 0}

    if not peaks:
        return 0.0, None

    driver = max(peaks, key=lambda k: peaks[k])
    return round(min(peaks[driver] / STRESS_SCALE_MAX, 1.0), 4), driver


def estimate_value(
    projection: StressProjection,
    chosen_window: SprayWindow | None,
    crop: Crop,
    area_ha: float,
    delay_days: int = 7,
) -> ValueEstimate | None:
    if chosen_window is None or not projection.days:
        return None

    spray_date = chosen_window.start.date()
    day_index = {d.date: i for i, d in enumerate(projection.days)}
    start = day_index.get(spray_date, 0)

    def stress_on(day_i: int) -> float:
        if day_i >= len(projection.days):
            return 0.0
        values = [v for v in projection.days[day_i].scores.values() if v is not None]
        return max(values, default=0.0)

    avoided = sum(stress_on(i) for i in range(start, min(start + delay_days, len(projection.days))))
    avoided_normalised = avoided / STRESS_SCALE_MAX

    margin = GROSS_MARGIN_PER_HA.get(crop, 50000.0)
    central = margin * area_ha * avoided_normalised * YIELD_PROTECTION_PER_STRESS_DAY

    low = int(max(central * (1 - VALUE_ESTIMATE_BAND), 0))
    high = int(central * (1 + VALUE_ESTIMATE_BAND))

    acres = max(area_ha / 0.404686, 1e-09)

    return ValueEstimate(
        low,
        high,
        int(low / acres),
        int(high / acres),
        basis=f"Compares applying in this window against applying {delay_days} days later, across {round(avoided_normalised, 2)} accumulated stress days on {round(area_ha, 2)} hectares.",
        delay_days=delay_days,
        stress_days=round(avoided_normalised, 2),
        area_ha=round(area_ha, 2),
    )


def _describe_factors(projection: StressProjection, candidates: CandidateDays, ranked: RankedHours) -> list[dict[str, Any]]:
    factors: list[dict[str, Any]] = []

    onset = projection.earliest_onset
    if onset:
        factors.append(
            {
                "key": "onset",
                "stress_type": onset.stress_type,
                "value": round(onset.value, 1),
                "date": onset.date.isoformat(),
            }
        )

    best_day = candidates.best
    if best_day:
        lead = best_day.days_before_onset or 0
        if lead > 0:
            factors.append({"key": "lead_time", "days": lead})
        else:
            factors.append({"key": "already_started"})

    window = ranked.best_window
    if window:
        factors.append(
            {
                "key": "window_conditions",
                "start": window.start.strftime("%H:%M"),
                "end": window.end.strftime("%H:%M"),
            }
        )
        rejected = [h for h in ranked.hours if not h.viable]
        if rejected:
            factors.append({"key": "hours_rejected", "rejected": len(rejected), "total": len(ranked.hours)})

    if candidates.stage_at_onset:
        factors.append({"key": "stage", "stage": candidates.stage_at_onset})

    return factors[:4]


def readiness(
    projection: StressProjection,
    candidates: CandidateDays,
    ranked: RankedHours,
    crop: Crop,
    area_ha: float,
    product: ProductKind = ProductKind.STRESS_BUSTER,
) -> Readiness:
    need, driver = compute_need(projection)

    best_day = candidates.best
    timing_fit = best_day.fit if best_day else 0.0

    window = ranked.best_window
    viability = ranked.viability

    score = int(round(need * timing_fit * viability * 100))

    blocked = candidates.blocked_reason
    check_again = None

    if window is None and blocked is None:
        blocked = "No hour in the coming days passes the spray conditions check. Every candidate hour was either too dry, too windy, or too close to rain."

    if blocked is not None:
        score = 0
        if projection.days:
            horizon = min(2, len(projection.days) - 1)
            check_again = projection.days[horizon].date

    return Readiness(
        score,
        need,
        round(timing_fit, 4),
        round(viability, 4),
        driver,
        window,
        best_day.date if best_day else None,
        candidates.stage_at_onset,
        product,
        estimate_value(projection, window, crop, area_ha),
        blocked_reason=blocked,
        check_again_on=check_again,
        factors=_describe_factors(projection, candidates, ranked),
    )
