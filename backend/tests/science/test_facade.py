"""Contract fixtures exercise pure science, not a live farmer workflow."""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from agrisense.contracts_generated import models as api
from agrisense.science.contract_bridge import measurement, to_contract
from agrisense.science.facade import compare_crops, evaluate_season, summarize_season
from agrisense.science.scenarios import economic_estimates
from agrisense.science.weather import Daily, Hour, WeatherBundle

ROOT = Path(__file__).resolve().parents[3]


def snapshot():
    return api.SeasonSnapshot.model_validate(
        json.loads((ROOT / "contracts/fixtures/cotton.snapshot.json").read_text())
    )


def references():
    return api.ReferenceBundle(
        version="synthetic-v1",
        crops=[api.Crop(id="cotton", name="Cotton", supported_for_biological_advice=True)],
        products=[],
        evidence=[
            api.EvidenceRecord(
                id="synthetic",
                kind="software_test",
                title="Synthetic arithmetic only",
                source="test_fixture",
                limitations=["not_field_evidence"],
            )
        ],
    )


def reviewed():
    return {
        "reviewed": True,
        "evidence_id": "synthetic",
        "valid_from": "2026-01-01",
        "valid_until": "2027-01-01",
    }


def forecast(snap):
    start = snap.as_of
    return to_contract(
        WeatherBundle(
            "synthetic",
            start,
            tuple(
                Hour(start + timedelta(hours=i), 25, 60, 8, 12, 0, 0.1, 200, 10, True, "synthetic")
                for i in range(24)
            ),
            tuple(
                Daily((start + timedelta(days=i)).date().isoformat(), 20, 35, 0, 5, "synthetic")
                for i in range(3)
            ),
            raw_payload_hash="synthetic",
            mode="demo",
        ),
        snap.field.centroid,
    )


def test_facade_generated_contract_replay_and_nulls():
    snap, refs = snapshot(), references()
    weather = forecast(snap)
    result = evaluate_season(snap, weather, refs)
    assert result == evaluate_season(snap, weather, refs)
    api.EvaluationBundle.model_validate_json(result.model_dump_json())
    assert result.recommendation.status == "insufficient_data"
    assert result.recommendation.selected_window is None
    assert result.recommendation.readiness is None
    assert result.economics.roi.p50 is None
    assert result.recommendation.stress_curve[0].value == 0.5
    assert result.data_mode == "demo"
    assert result.proposed_tasks == []


def test_foreign_future_and_bad_units_rejected():
    snap, refs = snapshot(), references()
    wrong = snap.model_copy(deep=True)
    wrong.season.field_id = "another-field"
    with pytest.raises(ValueError):
        evaluate_season(wrong, forecast(snap), refs)
    weather = forecast(snap)
    weather.hourly[0].wind_kmh.unit = "m/s"
    with pytest.raises(ValueError):
        evaluate_season(snap, weather, refs)


def test_paired_scenario_golden_and_actual_ledger_gate():
    refs = references()
    refs.parameters["economics:cotton"] = {
        **reviewed(),
        "product_form": "seed_cotton",
        "price_product_form": "seed_cotton",
        "costs_complete": True,
        "cost_basis": "cash",
    }
    refs.parameters["scenario:cotton:synthetic-1"] = {
        **reviewed(),
        "product_form": "seed_cotton",
        "cost_basis": "cash",
        "yield_kg_ha": 4000,
        "price_inr_kg": 20,
        "cost_inr_ha": 50000,
    }
    result = economic_estimates("cotton", 1, refs, date(2026, 9, 9))
    assert result.revenue.p50 == 80000
    assert result.profit.p50 == 30000
    assert result.roi.p50 == 60
    assert result.profit.basis == "scenario"
    assert (
        economic_estimates("cotton", 1, refs, date(2026, 9, 9), has_actual_ledger=True).roi.p50
        is None
    )
    refs.parameters["scenario:cotton:synthetic-1"]["yield_kg_ha"] = 0
    assert economic_estimates("cotton", 1, refs, date(2026, 9, 9)).roi.p50 == -100


def test_planner_returns_only_locally_evidenced_candidates():
    snap, refs = snapshot(), references()
    now = snap.as_of.date()
    soil = api.SoilObservation(
        id="synthetic-soil",
        field_id=snap.field.id,
        sampled_on=now,
        ph=measurement(6.2, "pH"),
        source="lab",
        confirmation_state="confirmed",
        version=1,
    )
    request = api.PlanningRequest(
        field_id=snap.field.id,
        proposed_season=api.DateInterval(start_date=now, end_date=now),
        candidate_crop_ids=["cotton", "rice"],
        available_water_m3=10000,
        budget_inr=200000,
    )
    planning = api.PlanningSnapshot(
        as_of=snap.as_of, field=snap.field, request=request, soil_observations=[soil]
    )
    climate = api.ClimateBundle(
        location=snap.field.centroid,
        period=api.DateInterval(start_date=date(2025, 1, 1), end_date=date(2025, 12, 31)),
        daily=[
            api.ForecastDay(
                local_date=date(2025, 1, 1) + timedelta(days=i),
                minimum_temperature_c=measurement(20, "°C"),
                maximum_temperature_c=measurement(30, "°C"),
                rain_mm=measurement(2, "mm"),
                et0_mm=measurement(4, "mm"),
            )
            for i in range(30)
        ],
        provenance=[api.Provenance(source="synthetic", data_mode="demo")],
        data_mode="demo",
    )
    refs.parameters["planning:cotton"] = {
        **reviewed(),
        "latitude_min": 20,
        "latitude_max": 22,
        "longitude_min": 78,
        "longitude_max": 80,
        "sowing_start_mmdd": "09-01",
        "sowing_end_mmdd": "09-30",
        "duration_min_days": 100,
        "duration_max_days": 140,
        "minimum_climate_days": 30,
        "ph_min": 6,
        "ph_max": 6.5,
        "seasonal_irrigation_mm": 100,
        "planned_cost_inr_ha": 50000,
    }
    result = compare_crops(planning, refs, climate)
    assert [row.crop_id for row in result.candidates] == ["cotton"]
    assert any(row.facts["crop_id"] == "rice" for row in result.exclusions)
    assert result.candidates[0].water.seasonal.p50 == 2000
    planning.request.available_water_m3 = 1
    assert compare_crops(planning, refs, climate).candidates == []


def test_closure_zero_yield_and_zero_cost():
    snap = snapshot()
    closure = api.SeasonClosure(
        id="synthetic-closure",
        season_id=snap.season.id,
        harvest_quantity_kg=0,
        product_form="seed_cotton",
        moisture_basis="declared",
        harvested_area_ha=1,
        realized_sales_inr=0,
        realized_costs_inr=50000,
        harvested_on=snap.as_of.date(),
        actual_margin_inr=-50000,
        confirmed_at=snap.as_of,
        expected_version=1,
        version=2,
    )
    result = summarize_season(api.ClosureSnapshot(season=snap, closure=closure))
    assert result.metrics[0].value == -50000
    assert result.metrics[1].value == -100
    closure.realized_costs_inr = 0
    revised = summarize_season(api.ClosureSnapshot(season=snap, closure=closure))
    assert revised.metrics[1].value is None
    assert revised.closure.actual_margin_inr == 0
