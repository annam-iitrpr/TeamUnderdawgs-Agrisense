"""Layer 2: turn a projected stress onset into candidate application days.

A biostimulant needs to be in the plant before the stress arrives, not during it.
This layer subtracts the physiological priming lead time from the projected onset
and intersects the result with the growth stages at which the product works.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as Date
from datetime import timedelta
from typing import Any

from .constants import GROWTH_STAGES, PRIMING_LEAD_DAYS, YIELD_BOOSTER_STAGES, Crop, GrowthStage, ProductKind
from .projection import StressProjection

PARTIAL_PRIMING_DAYS: int = 3
PARTIAL_PRIMING_MAX_FIT: float = 0.45


@dataclass(frozen=True)
class CandidateDay:
    date: Date
    fit: float
    reason: str
    stage: str
    days_before_onset: int | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "fit": self.fit,
            "reason": self.reason,
            "stage": self.stage,
            "days_before_onset": self.days_before_onset,
        }


@dataclass(frozen=True)
class CandidateDays:
    days: list[CandidateDay]
    stage_at_onset: str
    product_kind: ProductKind
    blocked_reason: str | None = None

    @property
    def best(self) -> CandidateDay | None:
        return max(self.days, key=lambda d: d.fit) if self.days else None

    def as_dict(self) -> dict[str, Any]:
        return {
            "days": [d.as_dict() for d in self.days],
            "stage_at_onset": self.stage_at_onset,
            "product_kind": self.product_kind.value,
            "blocked_reason": self.blocked_reason,
        }


def stage_for_gdd(crop: Crop, gdd: float) -> GrowthStage:
    stages = GROWTH_STAGES.get(crop)
    if not stages:
        return GrowthStage("unknown", 0, 0, False, False)
    for stage in stages:
        if stage.gdd_start <= gdd < stage.gdd_end:
            return stage
    return stages[-1]


def _stage_allows(product: ProductKind, crop: Crop, stage: GrowthStage) -> bool:
    if product is ProductKind.STRESS_BUSTER:
        return stage.is_vegetative or stage.is_reproductive
    return stage.name in YIELD_BOOSTER_STAGES.get(crop, frozenset())


def priming_window(
    projection: StressProjection,
    crop: Crop,
    gdd_since_sowing: float,
    product: ProductKind = ProductKind.STRESS_BUSTER,
    today: Date | None = None,
) -> CandidateDays:
    onset = projection.earliest_onset
    stage = stage_for_gdd(crop, gdd_since_sowing)

    if today is None:
        today = projection.days[0].date if projection.days else Date.today()

    if onset is None:
        return CandidateDays(
            [],
            stage.name,
            product,
            blocked_reason=f"No stress is projected to cross the action threshold in the next {len(projection.days)} days.",
        )

    if not _stage_allows(product, crop, stage):
        return CandidateDays(
            [],
            stage.name,
            product,
            blocked_reason=f"The crop is at {stage.name.replace('_', ' ')} and this product is not effective at that stage.",
        )

    lead_low = int(PRIMING_LEAD_DAYS.low)
    lead_high = int(PRIMING_LEAD_DAYS.high)

    candidates: list[CandidateDay] = []
    for lead in range(lead_low, lead_high + 1):
        day = onset.date - timedelta(days=lead)
        if day < today:
            continue

        distance_from_centre = abs(lead - PRIMING_LEAD_DAYS.mid)
        half_span = max((lead_high - lead_low) / 2.0, 1e-09)
        fit = round(max(0.0, 1.0 - distance_from_centre / (half_span + 1.0)), 4)

        candidates.append(
            CandidateDay(
                date=day,
                fit=fit,
                stage=stage.name,
                days_before_onset=lead,
                reason=f"{lead} days before {onset.stress_type.replace('_', ' ')} is projected to reach {onset.value:.1f} on {onset.date.isoformat()}, which gives the crop time to respond before the stress arrives.",
            )
        )

    if not candidates:
        if product is ProductKind.STRESS_BUSTER:
            return CandidateDays(
                [],
                stage.name,
                product,
                blocked_reason=f"The yield critical window has already passed for this season. Onset is projected for {onset.date.isoformat()}.",
            )

        for offset in range(0, PARTIAL_PRIMING_DAYS):
            day = today + timedelta(days=offset)
            fit = round(max(PARTIAL_PRIMING_MAX_FIT - 0.1 * offset, 0.1), 4)
            candidates.append(
                CandidateDay(
                    date=day,
                    fit=fit,
                    stage=stage.name,
                    days_before_onset=(onset.date - day).days,
                    reason=f"{onset.stress_type.replace('_', ' ').capitalize()} has already reached {onset.value:.1f} out of 9. There is no time left to prime the crop in advance, so this application is to help it recover and hold on through the stress.",
                )
            )

    candidates.sort(key=lambda c: c.date)

    return CandidateDays(candidates, stage.name, product)
