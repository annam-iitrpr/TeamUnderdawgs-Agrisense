"""CPU facade/planning benchmark. All reference values are synthetic test inputs.

Run with PYTHONPATH=backend. Nothing here is loaded by production reference_bundle.
"""

import json
import platform
from datetime import date, timedelta
from pathlib import Path
from statistics import median
from time import perf_counter

import numpy as np
from agrisense.contracts_generated import models as api
from agrisense.science.contract_bridge import measurement, to_contract
from agrisense.science.facade import compare_crops, evaluate_season
from agrisense.science.references import reference_bundle
from agrisense.science.weather import Daily, Hour, WeatherBundle


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    snap = api.SeasonSnapshot.model_validate_json(
        (root / "contracts/fixtures/cotton.snapshot.json").read_text()
    )
    now = snap.as_of.date()
    refs = reference_bundle()
    refs.version = "synthetic-benchmark-only"
    refs.evidence = [
        api.EvidenceRecord(
            id="synthetic",
            kind="software_test",
            title="Synthetic benchmark only",
            source="benchmark",
            limitations=["not_field_evidence"],
        )
    ]
    common = {
        "reviewed": True,
        "evidence_id": "synthetic",
        "valid_from": "2026-01-01",
        "valid_until": "2027-01-01",
    }
    for crop in refs.crops:
        refs.parameters[f"planning:{crop.id}"] = {
            **common,
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
        refs.parameters[f"economics:{crop.id}"] = {
            **common,
            "product_form": crop.id,
            "price_product_form": crop.id,
            "costs_complete": True,
            "cost_basis": "cash",
        }
        for year in range(20):
            refs.parameters[f"scenario:{crop.id}:{year}"] = {
                **common,
                "product_form": crop.id,
                "cost_basis": "cash",
                "yield_kg_ha": 4000 + year,
                "price_inr_kg": 20,
                "cost_inr_ha": 50000,
            }
    # Match generated scalar types before hashing/serializing the synthetic map.
    refs.parameters = {
        key: {
            name: float(value) if type(value) is int else value
            for name, value in record.items()
        }
        for key, record in refs.parameters.items()
    }
    refs = api.ReferenceBundle.model_validate(refs.model_dump())
    weather = to_contract(
        WeatherBundle(
            "synthetic",
            snap.as_of,
            tuple(
                Hour(snap.as_of + timedelta(hours=i), 25, 60, 8, rain_mm=0)
                for i in range(336)
            ),
            tuple(
                Daily((now + timedelta(days=i)).isoformat(), 20, 35, 0, 5, "synthetic")
                for i in range(14)
            ),
            mode="demo",
            raw_payload_hash="synthetic",
        ),
        snap.field.centroid,
    )
    planning = api.PlanningSnapshot(
        as_of=snap.as_of,
        field=snap.field,
        request=api.PlanningRequest(
            field_id=snap.field.id,
            candidate_crop_ids=[crop.id for crop in refs.crops],
            proposed_season=api.DateInterval(start_date=now, end_date=now),
            available_water_m3=10000,
            budget_inr=200000,
        ),
        soil_observations=[
            api.SoilObservation(
                id="synthetic",
                field_id=snap.field.id,
                sampled_on=now,
                ph=measurement(6.2, "pH"),
                source="lab",
                confirmation_state="confirmed",
                version=1,
            )
        ],
    )
    climate = api.ClimateBundle(
        location=snap.field.centroid,
        period=api.DateInterval(
            start_date=date(2025, 1, 1), end_date=date(2025, 12, 31)
        ),
        daily=[
            api.ForecastDay(
                local_date=date(2025, 1, 1) + timedelta(days=i),
                minimum_temperature_c=measurement(20, "°C"),
                maximum_temperature_c=measurement(30, "°C"),
                rain_mm=measurement(2, "mm"),
                et0_mm=measurement(4, "mm"),
            )
            for i in range(365)
        ],
        provenance=[api.Provenance(source="synthetic", data_mode="demo")],
        data_mode="demo",
    )
    reports = []
    for name, target, operation in (
        (
            "season_336_hours_scenario_economics",
            200,
            lambda: evaluate_season(snap, weather, refs),
        ),
        (
            "five_crops_2000_draws_each_365_climate_days",
            500,
            lambda: compare_crops(planning, refs, climate),
        ),
    ):
        timings = []
        for index in range(55):
            before = perf_counter()
            result = operation()
            elapsed = (perf_counter() - before) * 1000
            if isinstance(result, api.CropComparison):
                assert len(result.candidates) == 5
                assert all(
                    row.economics.profit.p50 is not None for row in result.candidates
                )
            else:
                assert result.economics.profit.p50 is not None
                assert len(result.recommendation.stress_curve) == 42
            if index >= 5:
                timings.append(elapsed)
        p95 = float(np.quantile(timings, 0.95))
        reports.append(
            {
                "case": name,
                "median_ms": median(timings),
                "p95_ms": p95,
                "target_ms": target,
                "target_met": p95 < target,
            }
        )
    print(
        json.dumps(
            {
                "synthetic_only": True,
                "runs": 50,
                "warmup_runs": 5,
                "python": platform.python_version(),
                "architecture": platform.machine(),
                "network_included": False,
                "field_accuracy_claim": False,
                "product_safety_evidence_absent": True,
                "benchmarks": reports,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
