"""Transparent local crop feasibility, using supplied reviewed records only."""

from datetime import date, timedelta
from zoneinfo import ZoneInfo

from agrisense.contracts_generated import models as api

from .contract_bridge import estimate
from .references import number, reviewed_parameters, select_soil
from .scenarios import economic_estimates


def sowing_overlap(record: dict, proposed: api.DateInterval) -> api.DateInterval | None:
    start_mmdd, end_mmdd = str(record["sowing_start_mmdd"]), str(record["sowing_end_mmdd"])
    intervals = []
    for year in range(proposed.start_date.year - 1, proposed.end_date.year + 1):
        start = date.fromisoformat(f"{year}-{start_mmdd}")
        end = date.fromisoformat(f"{year + (end_mmdd < start_mmdd)}-{end_mmdd}")
        lo, hi = max(start, proposed.start_date), min(end, proposed.end_date)
        if lo <= hi:
            intervals.append(api.DateInterval(start_date=lo, end_date=hi))
    return intervals[0] if intervals else None


def compare_crops(
    snapshot: api.PlanningSnapshot, references: api.ReferenceBundle, climate: api.ClimateBundle
) -> api.CropComparison:
    if snapshot.request.field_id != snapshot.field.id:
        raise ValueError("planning field identity mismatch")
    if any(row.field_id != snapshot.field.id for row in snapshot.existing_seasons):
        raise ValueError("foreign season in planning snapshot")
    now = snapshot.as_of.astimezone(ZoneInfo("Asia/Kolkata")).date()
    if snapshot.request.proposed_season.start_date < now:
        raise ValueError("proposed sowing date is in the past")
    allocated = sum(
        row.allocated_area_ha for row in snapshot.existing_seasons if row.status != "closed"
    )
    # v1 has no proposed per-crop area: comparison uses remaining field allocation.
    area = snapshot.field.area_ha - allocated
    if area <= 0:
        return api.CropComparison(
            candidates=[],
            exclusions=[api.Reason(code="no_unallocated_area")],
            data_mode="unavailable",
        )
    soil = select_soil(snapshot.soil_observations, snapshot.field.id, now)
    candidates, exclusions = [], []
    ids = sorted(set(snapshot.request.candidate_crop_ids))
    known_crops = {row.id for row in references.crops}
    for crop in ids:
        reasons = []
        record = reviewed_parameters(references, f"planning:{crop}", now)
        # The catalogue is the allow-list. A second hardcoded tuple beside it
        # meant adding a crop to the reference set silently failed to make it
        # plannable, which is exactly the drift the reference files exist to
        # prevent.
        if crop not in known_crops:
            reasons.append("crop_not_supported")
        if record is None:
            reasons.append("reviewed_regional_crop_reference_missing")
        if (
            climate.data_mode == "unavailable"
            or not climate.provenance
            or climate.period.end_date >= now
        ):
            reasons.append("historical_climate_required")
        if reasons:
            exclusions.extend(api.Reason(code=code, facts={"crop_id": crop}) for code in reasons)
            continue
        try:
            lat, lon = snapshot.field.centroid.latitude, snapshot.field.centroid.longitude
            if not (
                number(record, "latitude_min", low=-90, high=90)
                <= lat
                <= number(record, "latitude_max", low=-90, high=90)
                and number(record, "longitude_min", low=-180, high=180)
                <= lon
                <= number(record, "longitude_max", low=-180, high=180)
            ):
                reasons.append("outside_reference_region")
            if not (
                number(record, "latitude_min")
                <= climate.location.latitude
                <= number(record, "latitude_max")
                and number(record, "longitude_min")
                <= climate.location.longitude
                <= number(record, "longitude_max")
            ):
                reasons.append("climate_outside_reference_region")
            sowing = sowing_overlap(record, snapshot.request.proposed_season)
            if sowing is None:
                reasons.append("outside_local_sowing_calendar")
            minimum_days = int(number(record, "duration_min_days", low=1, high=730))
            maximum_days = int(number(record, "duration_max_days", low=minimum_days, high=730))
            minimum_climate_days = int(number(record, "minimum_climate_days", low=30))
            climate_dates = {
                row.local_date
                for row in climate.daily
                if all(
                    value.value is not None
                    for value in (
                        row.minimum_temperature_c,
                        row.maximum_temperature_c,
                        row.rain_mm,
                        row.et0_mm,
                    )
                )
            }
            if len(climate_dates) < minimum_climate_days or any(
                not climate.period.start_date <= day <= climate.period.end_date
                for day in climate_dates
            ):
                reasons.append("climate_coverage_incomplete")
            ph = None if soil is None or soil.ph is None else soil.ph.value
            if ph is None:
                reasons.append("soil_ph_missing")
            elif soil.ph.unit != "pH":
                reasons.append("soil_ph_unit_mismatch")
            elif (
                not number(record, "ph_min", low=0, high=14)
                <= ph
                <= number(record, "ph_max", low=0, high=14)
            ):
                reasons.append("soil_ph_outside_supported_range")
            water_mm = number(record, "seasonal_irrigation_mm", low=0)
            water_m3 = water_mm * area * 10
            available = snapshot.request.available_water_m3
            if water_m3 > 0 and (available is None or available < water_m3):
                reasons.append("irrigation_budget_missing_or_insufficient")
            cost = number(record, "planned_cost_inr_ha", low=0) * area
            if snapshot.request.budget_inr is None or snapshot.request.budget_inr < cost:
                reasons.append("cash_budget_missing_or_insufficient")
        except (KeyError, ValueError, TypeError):
            exclusions.append(api.Reason(code="invalid_crop_reference", facts={"crop_id": crop}))
            continue
        if reasons:
            exclusions.extend(
                api.Reason(code=reason, facts={"crop_id": crop}) for reason in reasons
            )
            continue
        water_fit = 1 if water_m3 == 0 else min(1, (available - water_m3) / max(available, 1))
        budget_fit = (
            1
            if cost == 0
            else min(1, (snapshot.request.budget_inr - cost) / max(snapshot.request.budget_inr, 1))
        )
        duration_fit = 1 - maximum_days / 730
        # Suitability comes from the reviewed record, not a constant. It used to
        # be hardcoded to 1 for every crop, which meant the ranking was pure
        # water-and-budget efficiency: a field pea outranked wheat in Punjab
        # because it drinks less, which is not an answer to "what should I sow".
        suitability = number(record, 'regional_suitability', low=0, high=1)
        # Weights are data too, so the emphasis can be changed by an agronomist
        # without touching this file. They are ranking weights and nothing more.
        weights = references.parameters.get('ranking_weights') or {}
        score = (
            number(weights, 'suitability', low=0, high=1) * suitability
            + number(weights, 'water_fit', low=0, high=1) * water_fit
            + number(weights, 'budget_fit', low=0, high=1) * budget_fit
            + number(weights, 'duration_fit', low=0, high=1) * duration_fit
        )
        evidence = str(record["evidence_id"])
        candidates.append(
            api.CropPlan(
                crop_id=crop,
                sowing_interval=sowing,
                harvest_interval=api.DateInterval(
                    start_date=sowing.start_date + timedelta(days=minimum_days),
                    end_date=sowing.end_date + timedelta(days=maximum_days),
                ),
                compatibility={
                    "suitability": suitability,
                    "water_fit": water_fit,
                    "budget_fit": budget_fit,
                    "duration_fit": duration_fit,
                    "overall": score,
                },
                water=api.WaterEstimate(
                    seasonal=estimate(
                        water_m3,
                        "m³",
                        "seasonal_irrigation",
                        assumptions=["reviewed_regional_scenario", "remaining_field_area_used"],
                        evidence_ids=[evidence],
                    )
                ),
                economics=economic_estimates(crop, area, references, now),
                suitability_evidence_ids=[evidence],
            )
        )
    candidates.sort(key=lambda row: (-row.compatibility["overall"], row.crop_id))
    return api.CropComparison(
        candidates=candidates[:5],
        exclusions=exclusions,
        data_mode="demo"
        if climate.data_mode == "demo"
        else "estimated"
        if candidates
        else "unavailable",
        warnings=[
            "ranking_weights_are_project_choices",
            "no_cross_crop_yield_comparison",
            "economics_requires_paired_yield_price_cost_records",
        ],
    )
