"""Public science interface: generated contracts in/out, no IO in pure functions.

Platform owns authorization, persistence, scheduling and reference loading.
Read-only provider configuration is isolated in the async weather export below.
"""

import json
from datetime import datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from zoneinfo import ZoneInfo

from agrisense.contracts_generated import models as api

from .contract_bridge import estimate, from_contract, measurement, to_contract
from .planning import compare_crops
from .references import number, reviewed_parameters, select_soil_moisture
from .scenarios import economic_estimates
from .stress import CARDINALS, heat_stress
from .water import RootZone, root_zone_day
from .weather import utc
from .windows import Candidate, SprayPolicy, duration_hours, rank_windows

RULE_VERSION = "advisory_v1.0.0"
IST = ZoneInfo("Asia/Kolkata")
__all__ = ["build_weather_bundle", "compare_crops", "evaluate_season", "summarize_season"]


def _check_snapshot(snapshot: api.SeasonSnapshot) -> None:
    if (
        snapshot.season.field_id != snapshot.field.id
        or snapshot.field.farmer_id != snapshot.farmer.id
    ):
        raise ValueError("inconsistent authorized snapshot identities")
    if snapshot.season.allocated_area_ha > snapshot.field.area_ha:
        raise ValueError("season allocation exceeds field area")
    for row in snapshot.journal + snapshot.cost_ledger:
        if row.season_id != snapshot.season.id or row.occurred_at > snapshot.as_of:
            raise ValueError("foreign or future snapshot fact")


def _stress(snapshot: api.SeasonSnapshot, forecast: api.ForecastBundle) -> list[api.StressPoint]:
    if snapshot.season.crop_id not in CARDINALS:
        return []
    curve = []
    for day in sorted(forecast.daily, key=lambda row: row.local_date):
        if day.local_date < snapshot.as_of.astimezone(IST).date():
            continue
        stress = heat_stress(
            snapshot.season.crop_id,
            day.maximum_temperature_c.value,
            day.minimum_temperature_c.value,
        )
        for kind, value in (
            ("day_heat", stress.day),
            ("night_heat", stress.night),
            ("frost", stress.frost),
        ):
            curve.append(
                api.StressPoint(
                    local_date=day.local_date,
                    stress_type=kind,
                    value=None if value is None else value / 9,
                    missing_reason="not_parameterized_or_input_missing" if value is None else None,
                )
            )
    return curve


def _onsets(
    curve: list[api.StressPoint], threshold: float, persistence: int
) -> list[api.StressOnset]:
    result = []
    for kind in ("day_heat", "night_heat", "frost"):
        days = sorted(
            (row for row in curve if row.stress_type == kind), key=lambda row: row.local_date
        )
        onset = None
        for index in range(len(days) - persistence + 1):
            run = days[index : index + persistence]
            if all(
                row.value is not None
                and row.value >= threshold
                and row.local_date == run[0].local_date + timedelta(days=i)
                for i, row in enumerate(run)
            ):
                onset = run[0].local_date
                break
        result.append(
            api.StressOnset(
                stress_type=kind,
                local_date=onset,
                threshold=threshold,
                reason="project_assumption_pending_validation",
            )
        )
    return result


def _water(
    snapshot: api.SeasonSnapshot, forecast: api.ForecastBundle, references: api.ReferenceBundle
) -> api.WaterEstimate:
    now = snapshot.as_of.astimezone(IST).date()
    record = reviewed_parameters(references, f"water:{snapshot.season.crop_id}", now)
    missing = "reviewed_water_parameters_required"
    result = api.WaterEstimate(
        seasonal=estimate(None, "m³", "seasonal_irrigation", "seasonal_climate_required"),
        missing_reason=missing,
    )
    if record is None:
        return result
    try:
        kc = number(record, "kc", low=0, high=3)
        zone = RootZone(
            number(record, "field_capacity", low=0, high=1),
            number(record, "wilting_point", low=0, high=1),
            number(record, "root_depth_m", low=0.001),
            number(record, "depletion_fraction", low=0, high=1),
            number(record, "efficiency", low=0.001, high=1),
        )
    except (KeyError, ValueError, TypeError):
        result.missing_reason = "invalid_water_parameters"
        return result
    # The moisture reading specifically, not the best soil record overall: a
    # Soil Health Card is an observation too and carries no moisture at all.
    soil = select_soil_moisture(snapshot.soil_observations, snapshot.field.id, now)
    depletion = None
    # Today's, because root-zone water does not keep. `select_soil_moisture` has
    # already guaranteed the basis, unit and presence of a value.
    if soil and soil.sampled_on == now:
        theta = soil.moisture.value
        if theta is not None and 0 <= theta <= 1:
            depletion = min(
                zone.taw, max(0, 1000 * (zone.field_capacity - theta) * zone.root_depth_m)
            )
    days = [
        day
        for day in sorted(forecast.daily, key=lambda row: row.local_date)
        if now <= day.local_date < now + timedelta(days=7)
    ]
    previous = now - timedelta(days=1)
    daily = []
    triggered = None
    reason = "initial_storage_unknown"
    for day in days:
        if day.local_date != previous + timedelta(days=1):
            depletion = None
        previous = day.local_date
        if day.et0_mm.value is None or day.rain_mm.value is None:
            daily.append(measurement(None, "L", f"{day.local_date}:rain_or_et0_missing"))
            depletion = None
            continue
        # Rice remains demand-only until ponded-water/AWD management is supplied.
        balance = root_zone_day(
            zone,
            depletion_mm=depletion,
            et0_mm=day.et0_mm.value,
            kc=kc,
            rain_mm=day.rain_mm.value,
            area_ha=snapshot.season.allocated_area_ha,
            flooded_paddy=snapshot.season.crop_id == "rice",
        )
        depletion = balance["depletion_mm"]
        reason = balance.get("reason")
        if "irrigation_triggered" in balance:
            triggered = bool(triggered) or balance["irrigation_triggered"]
        daily.append(measurement(balance["litres"], "L", f"{day.local_date}:{reason}"))
    result.daily = daily
    result.irrigation_needed = triggered
    result.missing_reason = reason
    result.assumptions = [
        "standard_demand_scenario",
        "no_future_irrigation_assumed",
        "daily_values_are_replenishment_alternatives_do_not_sum",
        "same_day_vwc_initialization_when_available",
    ]
    return result


def evaluate_season(
    snapshot: api.SeasonSnapshot, forecast: api.ForecastBundle, references: api.ReferenceBundle
) -> api.EvaluationBundle:
    _check_snapshot(snapshot)
    weather = from_contract(forecast)
    original_snapshot = snapshot
    # The platform captures farm facts before fetching weather. Use the later
    # supplied timestamp for evaluation without changing those immutable facts.
    # Archived forecast eligibility is checked by the offline evaluation pipeline.
    snapshot = snapshot.model_copy(
        update={"as_of": max(utc(snapshot.as_of), utc(forecast.retrieved_at))}
    )
    now = snapshot.as_of.astimezone(IST).date()
    curve = _stress(snapshot, forecast)
    config = references.parameters.get("onset", {})
    threshold = number(config, "threshold", low=0, high=1) if "threshold" in config else 4 / 9
    persistence = (
        int(number(config, "persistence_days", low=1, high=14))
        if "persistence_days" in config
        else 2
    )
    onsets = _onsets(curve, threshold, persistence)
    reasons = [api.Reason(code="rule_parameters_require_field_validation")]
    status, readiness, need, timing_fit, viability = "insufficient_data", None, None, None, None
    selected, alternatives, fit = None, [], None
    product = None
    # Read from the catalogue, not a hardcoded tuple. `Crop` already carries
    # `supported_for_biological_advice`, and a second list beside it meant
    # adding a crop to the reference set left it silently out of scope here —
    # the third place this same duplication had crept in.
    supported = {row.id for row in references.crops if row.supported_for_biological_advice}
    if snapshot.season.crop_id not in supported:
        status = "out_of_scope"
        reasons.append(api.Reason(code="india_biological_crop_not_supported"))
    elif snapshot.season.status == "closed":
        status = "blocked"
        reasons.append(api.Reason(code="season_closed"))
    else:
        eligible = [p for p in references.products if snapshot.season.crop_id in p.crop_ids]
        if len(eligible) != 1:
            reasons.append(api.Reason(code="confirmed_product_selection_required"))
        else:
            product = eligible[0]
            record = reviewed_parameters(references, f"product:{product.id}", now)
            fit_reasons = []
            if record is None:
                fit_reasons.append(api.Reason(code="reviewed_product_label_required"))
            elif snapshot.season.stage not in str(record.get("stages", "")).split(","):
                fit_reasons.append(api.Reason(code="product_stage_mismatch"))
                status = "blocked"
            elif snapshot.season.stage_source not in ("farmer", "observed"):
                fit_reasons.append(api.Reason(code="confirmed_stage_required"))
            else:
                try:
                    policy_fields = {
                        key: number(record, key)
                        for key in (
                            "wind_min_kmh",
                            "wind_max_kmh",
                            "gust_max_kmh",
                            "wind_height_m",
                            "delta_t_min_c",
                            "delta_t_max_c",
                            "temperature_min_c",
                            "temperature_max_c",
                            "rain_max_mm",
                            "rain_probability_max",
                            "rainfast_hours",
                        )
                    }
                    policy = SprayPolicy(str(record["evidence_id"]), True, **policy_fields)
                    capacity = number(record, "equipment_capacity_ha_hour", low=0.001)
                    duration = duration_hours(snapshot.season.allocated_area_ha, capacity)
                    category = record["category"]
                    if category not in ("stress_buster", "yield_booster"):
                        raise ValueError("unrecognized biological category")
                    covered = str(record.get("stress_types", "")).split(",")
                    points = [
                        row for row in curve if row.stress_type in covered and row.value is not None
                    ]
                    need = (
                        1.0
                        if category == "yield_booster"
                        else max((row.value for row in points), default=None)
                    )
                    onset = min(
                        (
                            row.local_date
                            for row in onsets
                            if row.stress_type in covered and row.local_date
                        ),
                        default=None,
                    )
                    lead_min = number(record, "lead_min_days", low=0, high=14)
                    lead_max = number(record, "lead_max_days", low=lead_min, high=14)
                    candidates = []
                    for hour in weather.hours:
                        local_date = hour.start_at.astimezone(IST).date()
                        lead = None if onset is None else (onset - local_date).days
                        if category == "yield_booster" or (
                            lead is not None and lead_min <= lead <= lead_max
                        ):
                            candidates.append(
                                Candidate(
                                    hour.start_at,
                                    hour.start_at + timedelta(hours=duration),
                                    need,
                                    1.0,
                                )
                            )
                    if need == 0:
                        status, readiness = "monitor", 0
                        reasons.append(api.Reason(code="no_supported_stress_need"))
                    elif category == "stress_buster" and onset is None:
                        reasons.append(api.Reason(code="persistent_stress_onset_not_identified"))
                    else:
                        ranking = rank_windows(
                            weather,
                            tuple(candidates),
                            policy,
                            as_of=snapshot.as_of,
                            area_ha=snapshot.season.allocated_area_ha,
                            capacity_ha_hour=capacity,
                        )
                        status, readiness = ranking["status"], ranking["readiness"]
                        chosen = ranking["selected_window"]
                        if chosen:
                            selected = api.Interval(
                                start_at=chosen["start_at"], end_at=chosen["end_at"]
                            )
                            need, timing_fit, viability = (
                                chosen["need"],
                                chosen["timing_fit"],
                                chosen["viability"],
                            )
                            alternatives = [
                                api.Interval(start_at=row["start_at"], end_at=row["end_at"])
                                for row in ranking["alternatives"]
                            ]
                        rejection_codes = {
                            code for row in ranking["rejected"] for code in row["reasons"]
                        }
                        reasons.extend(
                            api.Reason(code=code)
                            for code in sorted(rejection_codes | set(ranking["reasons"]))
                        )
                except (KeyError, ValueError, TypeError):
                    fit_reasons.append(api.Reason(code="product_parameters_incomplete_or_invalid"))
            fit = api.ProductFit(
                product_id=product.id,
                eligible=not fit_reasons,
                reasons=fit_reasons,
                label_evidence_ids=product.evidence_ids,
            )
            reasons.extend(fit_reasons)
    identity = sha256(
        json.dumps(
            [
                original_snapshot.model_dump(mode="json"),
                forecast.model_dump(mode="json"),
                references.model_dump(mode="json"),
                RULE_VERSION,
            ],
            sort_keys=True,
        ).encode()
    ).hexdigest()
    recommendation = api.Recommendation(
        id=f"rec_{identity[:32]}",
        field_id=snapshot.field.id,
        season_id=snapshot.season.id,
        input_version=snapshot.season.version,
        input_hash=snapshot.input_hash,
        generated_at=utc(snapshot.as_of),
        expires_at=utc(snapshot.as_of) + timedelta(minutes=45),
        product_id=None if product is None else product.id,
        rule_version=RULE_VERSION,
        model_version="rules-only",
        evidence_versions=[references.version],
        status=status,
        readiness=readiness,
        need=need,
        timing_fit=timing_fit,
        viability=viability,
        stage=snapshot.season.stage,
        stress_curve=curve,
        stress_onsets=onsets,
        selected_window=selected,
        alternative_windows=alternatives,
        reasons=reasons,
        product_fit=fit,
        forecast_provenance=forecast.provenance,
        incremental_value=estimate(
            None, "INR", "incremental_timing_value", "crop_product_response_evidence_required"
        ),
    )
    tasks = []
    if selected is not None:
        tasks.append(
            api.TaskSpec(
                season_id=snapshot.season.id,
                source_recommendation_id=recommendation.id,
                due=selected,
                priority="normal",
                reason=api.Reason(code="review_application_conditions"),
                title="Recheck field conditions before the application window",
                deduplication_key=f"{recommendation.id}:recheck",
            )
        )
    return api.EvaluationBundle(
        recommendation=recommendation,
        water=_water(snapshot, forecast, references),
        economics=economic_estimates(
            snapshot.season.crop_id,
            snapshot.season.allocated_area_ha,
            references,
            now,
            has_actual_ledger=bool(snapshot.cost_ledger),
        ),
        proposed_tasks=tasks,
        data_mode="demo" if forecast.data_mode == "demo" else "mixed" if curve else "unavailable",
        warnings=["scenario_not_field_validated", "v1_safety_and_economics_extensions_pending"],
    )


def summarize_season(snapshot: api.ClosureSnapshot) -> api.SeasonEvaluation:
    _check_snapshot(snapshot.season)
    closure = snapshot.closure
    if closure.season_id != snapshot.season.season.id:
        raise ValueError("closure season mismatch")
    if closure.harvested_area_ha > snapshot.season.season.allocated_area_ha:
        raise ValueError("harvested area exceeds allocation")
    if closure.harvested_on > closure.confirmed_at.astimezone(IST).date():
        raise ValueError("closure harvest is in the future")
    if any(row.season_id != closure.season_id for row in snapshot.recommendations):
        raise ValueError("foreign recommendation in closure snapshot")
    margin = float(
        Decimal(str(closure.realized_sales_inr)) - Decimal(str(closure.realized_costs_inr))
    )
    # Revisions may change realized costs; never preserve a stale supplied margin.
    closure = closure.model_copy(update={"actual_margin_inr": margin})
    metrics = [
        api.ErrorMetric(name="actual_margin", value=margin, unit="INR", denominator_policy="none")
    ]
    cost = closure.realized_costs_inr
    metrics.append(
        api.ErrorMetric(
            name="actual_roi",
            value=None if cost <= 0 else 100 * margin / cost,
            unit="%",
            denominator_policy="null_when_cost_zero",
            missing_reason="zero_cost" if cost <= 0 else None,
        )
    )
    return api.SeasonEvaluation(
        season_id=closure.season_id,
        closure=closure,
        metrics=metrics,
        warnings=["vintage_economics_forecasts_missing_no_error_claim"],
    )


async def build_weather_bundle(
    location: api.Location, horizon: int, as_of: datetime
) -> api.ForecastBundle:
    """Production-facing weather export. No fixture fallback; no env file loading."""
    import os

    from .providers import (
        CEHubProvider,
        JsonTransport,
        OpenMeteoProvider,
    )
    from .providers import (
        build_weather_bundle as fetch,
    )

    transport = JsonTransport()
    try:
        providers = []
        if os.getenv("CEHUB_API_KEY") or os.getenv("CEHUB_BEARER_TOKEN"):
            providers.append(
                CEHubProvider(
                    transport,
                    api_key=os.getenv("CEHUB_API_KEY"),
                    bearer_token=os.getenv("CEHUB_BEARER_TOKEN"),
                    api_key_header=os.getenv("CEHUB_API_KEY_HEADER", "ApiKey"),
                )
            )
        if os.getenv("OPENMETEO_PERMITTED_FREE_USE") == "true":
            providers.append(OpenMeteoProvider(transport, permitted_free_use=True))
        bundle = await fetch(
            (location.latitude, location.longitude), horizon, as_of, providers=tuple(providers)
        )
        return to_contract(bundle, location)
    finally:
        await transport.close()
