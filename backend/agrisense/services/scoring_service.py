"""Orchestration between the agronomy engine and the data clients.

This is the only place that knows about both. The engine stays pure and the clients
stay dumb, and everything that could fail on the network is handled here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date as Date
from datetime import timedelta
from typing import Any

from agrisense.agronomy.constants import Crop, ProductKind
from agrisense.agronomy.projection import StressProjection, project_stress
from agrisense.agronomy.scoring import Readiness, readiness
from agrisense.agronomy.stress import accumulate_gdd
from agrisense.agronomy.timing import CandidateDays, priming_window, stage_for_gdd
from agrisense.agronomy.types import FieldContext
from agrisense.agronomy.viability import RankedHours, spray_viability
from agrisense.clients.base import Provenance
from agrisense.clients.meteoblue import MeteoblueClient
from agrisense.clients.resolver import ForecastResolver
from agrisense.config import Settings, get_settings
from agrisense.models.tables import FieldRecord

from .explain import format_factors, get_explanation_engine

log = logging.getLogger(__name__)


@dataclass
class ScoreResult:
    """Everything the API needs to answer a scoring request."""

    readiness: Readiness
    projection: StressProjection
    candidates: CandidateDays
    ranked: RankedHours
    reason_text: str
    provenance: list[Provenance]
    gdd_since_sowing: float
    stage: str
    factors: list[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            **self.readiness.as_dict(),
            "factors": self.factors,
            "reason_text": self.reason_text,
            "stage": self.stage,
            "gdd_since_sowing": round(self.gdd_since_sowing, 1),
            "season_yield_risk": self.projection.season_yield_risk,
            "provenance": [p.as_dict() for p in self.provenance],
        }


def choose_product(crop: Crop, gdd_since_sowing: float, projection: StressProjection) -> ProductKind:
    """Stress Buster when a stress is coming, Yield Booster at the yield critical stage.

    Yield Booster only makes sense in its narrow stage window, so it is selected when
    the crop is standing in that stage and no acute stress dominates.
    """
    from agrisense.agronomy.constants import YIELD_BOOSTER_STAGES

    stage = stage_for_gdd(crop, gdd_since_sowing)
    in_yield_stage = stage.name in YIELD_BOOSTER_STAGES.get(crop, frozenset())

    if projection.earliest_onset is not None:
        return ProductKind.STRESS_BUSTER

    if in_yield_stage:
        return ProductKind.YIELD_BOOSTER

    return ProductKind.STRESS_BUSTER


class ScoringService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.forecast = ForecastResolver(self.settings)

    async def _season_to_date(self, record: FieldRecord, crop: Crop) -> tuple[float, float, Provenance | None]:
        """Accumulated GDD and rainfall since sowing, from meteoblue where possible.

        Falls back to a climatological estimate rather than failing, because the
        stage calculation must always produce an answer.
        """
        if self.settings.should_try_live(self.settings.meteoblue_available):
            try:
                history = await MeteoblueClient(self.settings).season(
                    record.lat, record.lon, record.sowing_date, Date.today()
                )
                gdd = accumulate_gdd([(d.tmax_c, d.tmin_c) for d in history.days], crop)
                rain = sum(d.precipitation_mm for d in history.days)
                return gdd, rain, history.provenance
            except Exception as exc:
                log.warning("meteoblue season history failed: %s", exc)

        days_since_sowing = max((Date.today() - record.sowing_date).days, 1)

        typical_daily_gdd = {"rice": 14.0, "wheat": 12.0, "cotton": 12.5}.get(crop.value, 12.0)
        typical_daily_rain = {"rice": 6.0, "wheat": 1.2, "cotton": 4.0}.get(crop.value, 3.0)

        return (
            days_since_sowing * typical_daily_gdd,
            days_since_sowing * typical_daily_rain,
            Provenance(
                "Climatological estimate",
                False,
                note="Season to date GDD and rainfall are estimated from typical daily values because historical weather was not available.",
            ),
        )

    async def score_field(self, record: FieldRecord, language: str = "en") -> ScoreResult:
        crop = Crop(record.crop)
        provenance: list[Provenance] = []

        daily = await self.forecast.daily(record.lat, record.lon, 14)
        hourly = await self.forecast.hourly(record.lat, record.lon, 336)
        provenance.extend([daily.provenance, hourly.provenance])

        gdd, season_rain, season_prov = await self._season_to_date(record, crop)
        if season_prov:
            provenance.append(season_prov)

        context = FieldContext(
            crop=record.crop,
            lat=record.lat,
            lon=record.lon,
            area_ha=record.area_ha,
            sowing_date=record.sowing_date,
            soil_ph=record.soil_ph,
            soil_moisture_pct=record.soil_moisture_pct,
            nitrogen_g_per_kg=record.nitrogen_g_per_kg,
        )

        projection = project_stress(
            context,
            daily.days,
            gdd_since_sowing=gdd,
            season_precipitation_mm=season_rain,
        )

        product = choose_product(crop, gdd, projection)

        today = daily.days[0].date if daily.days else Date.today()
        candidates = priming_window(projection, crop, gdd, product=product, today=today)

        candidate_dates = [c.date for c in candidates.days] if candidates.days else None
        ranked = spray_viability(hourly.hours, candidate_dates)

        result = readiness(projection, candidates, ranked, crop, record.area_ha, product=product)

        reason = await get_explanation_engine(self.settings).explain(result, language)

        return ScoreResult(
            result,
            projection,
            candidates,
            ranked,
            reason,
            provenance,
            gdd,
            stage_for_gdd(crop, gdd).name,
            factors=format_factors(result.factors, language),
        )

    async def backtest(self, record: FieldRecord, season_start: Date, season_end: Date) -> dict[str, Any]:
        """Run the engine against a past season from meteoblue history.

        When no meteoblue key is present this returns a clearly labelled fixture
        result rather than an error, so the screen always has something honest to show.
        """
        crop = Crop(record.crop)

        if not self.settings.should_try_live(self.settings.meteoblue_available):
            return await self._fixture_backtest(record, season_start, season_end, crop)

        try:
            history = await MeteoblueClient(self.settings).history(record.lat, record.lon, season_start, season_end)
        except Exception as exc:
            log.warning("Backtest history unavailable: %s", exc)
            return await self._fixture_backtest(record, season_start, season_end, crop)

        context = FieldContext(
            crop=record.crop,
            lat=record.lat,
            lon=record.lon,
            area_ha=record.area_ha,
            sowing_date=season_start,
            soil_ph=record.soil_ph,
            soil_moisture_pct=record.soil_moisture_pct,
            nitrogen_g_per_kg=record.nitrogen_g_per_kg,
        )

        calls: list[dict[str, Any]] = []
        days = history.days
        for start in range(0, max(len(days) - 14, 1), 7):
            window = days[start : start + 14]
            if len(window) < 7:
                continue

            gdd = accumulate_gdd([(d.tmax_c, d.tmin_c) for d in days[:start] or window], crop)
            projection = project_stress(
                context,
                window,
                gdd,
                season_precipitation_mm=sum(d.precipitation_mm for d in days[:start]),
            )

            onset = projection.earliest_onset

            calls.append(
                {
                    "as_of": window[0].date.isoformat(),
                    "would_have_flagged": onset is not None,
                    "stress_type": onset.stress_type if onset else None,
                    "onset_date": onset.date.isoformat() if onset else None,
                    "peak_observed": round(
                        max((v for d in projection.days for v in d.scores.values() if v is not None), default=0.0),
                        2,
                    ),
                }
            )

        flagged = [c for c in calls if c["would_have_flagged"]]

        return {
            "field_id": record.id,
            "season_start": season_start.isoformat(),
            "season_end": season_end.isoformat(),
            "calls": calls,
            "summary": {
                "windows_evaluated": len(calls),
                "windows_flagged": len(flagged),
                "days_of_history": len(days),
            },
            "provenance": [history.provenance.as_dict()],
            "is_fixture": False,
        }

    async def _fixture_backtest(
        self, record: FieldRecord, season_start: Date, season_end: Date, crop: Crop
    ) -> dict[str, Any]:
        """A pre-computed, clearly labelled backtest for the no-key path."""
        calls = [
            {
                "as_of": (season_start + timedelta(days=7 * i)).isoformat(),
                "would_have_flagged": i in frozenset({2, 3, 6, 7}),
                "stress_type": "heat_diurnal" if i in frozenset({2, 3, 6, 7}) else None,
                "onset_date": (season_start + timedelta(days=7 * i + 5)).isoformat()
                if i in frozenset({2, 3, 6, 7})
                else None,
                "peak_observed": [1.2, 2.4, 5.6, 6.8, 3.1, 2.0, 7.2, 8.1, 3.4, 1.1][i % 10],
            }
            for i in range(10)
        ]

        return {
            "field_id": record.id,
            "season_start": season_start.isoformat(),
            "season_end": season_end.isoformat(),
            "calls": calls,
            "summary": {
                "windows_evaluated": len(calls),
                "windows_flagged": sum(1 for c in calls if c["would_have_flagged"]),
                "days_of_history": 0,
            },
            "provenance": [
                Provenance(
                    "Bundled backtest fixture",
                    False,
                    note="No meteoblue key is configured, so this is a pre-computed example rather than a real historical run.",
                ).as_dict()
            ],
            "is_fixture": True,
        }
