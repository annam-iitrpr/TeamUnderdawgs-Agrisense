"""Contract fixtures exercise pure science, not a live farmer workflow."""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from agrisense.contracts_generated import models as api
from agrisense.science.contract_bridge import measurement, to_contract
from agrisense.science.facade import compare_crops, evaluate_season, summarize_season
from agrisense.science.references import reference_bundle, reference_dir, reviewed_parameters
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


def test_production_reference_loader_is_fresh_and_isolated():
    """Each call hands back models the caller cannot use to corrupt the cache.

    The reference files are read once and memoised, so a caller that mutates a
    returned bundle must not be able to change what every later request in the
    process sees.
    """
    refs = reference_bundle()
    assert len(refs.crops) == 15
    # The catalogue must not exceed the reference set: a crop a farmer can pick
    # but the engine can only decline is worse than a shorter list.
    planned = {key.split(":", 1)[1] for key in refs.parameters if key.startswith("planning:")}
    assert {crop.id for crop in refs.crops} == planned
    refs.crops.clear()
    refs.parameters.clear()
    refs.evidence.clear()
    fresh = reference_bundle()
    assert len(fresh.crops) == 15
    assert fresh.parameters
    assert fresh.evidence


def test_every_shipped_parameter_record_passes_its_own_review_gate():
    """A record present in the files is not thereby usable.

    `reviewed_parameters` is the only way science reads a parameter, and it
    demands a review flag, an evidence id that resolves in the catalog, and a
    validity window covering the date asked about. Shipping a record that fails
    its own gate would be a silent no-op, so every one is checked here.
    """
    refs = reference_bundle()
    catalog = {row.id for row in refs.evidence}
    assert refs.parameters, "the shipped reference files supply no parameters"
    # `ranking_weights` is configuration, not an agronomic claim about a crop:
    # it decides display order and has no evidence to cite.
    for key in (k for k in refs.parameters if k != "ranking_weights"):
        record = reviewed_parameters(refs, key, date(2026, 9, 10))
        assert record is not None, f"{key} does not pass reviewed_parameters"
        assert record["evidence_id"] in catalog
        # Every source the record actually draws on is named, not just the one
        # the gate happens to check.
        for extra in ("evidence_id_root_zone", "evidence_id_soil_water"):
            if extra in record:
                assert record[extra] in catalog, f"{key}.{extra} is not in the evidence catalog"


def test_water_records_carry_the_published_available_water_difference():
    """Total available water is the sourced quantity, so the split must preserve it.

    Only the *difference* between field capacity and wilting point is taken from
    a publication; the absolute values are a texture-typical split. A future edit
    that changes one without the other would silently alter every irrigation
    figure, so the invariant is asserted rather than trusted.
    """
    refs = reference_bundle()
    assert refs.parameters["ranking_weights"]["suitability"] > 0
    water_keys = [key for key in refs.parameters if key.startswith("water:")]
    # One per catalogue crop: a crop with a sowing calendar but no water
    # parameters would rank and then refuse to say what it needs to drink.
    assert len(water_keys) == len(refs.crops) == 15
    for key in water_keys:
        record = refs.parameters[key]
        difference_mm_per_m = (record["field_capacity"] - record["wilting_point"]) * 1000
        assert difference_mm_per_m == pytest.approx(record["available_water_mm_per_m"])
        # FAO Irrigation Water Management Manual 1 gives loam as 100-175 mm/m.
        assert 100 <= record["available_water_mm_per_m"] <= 175
        # 1.0 means the figure is a NET requirement. Anything lower is a claim
        # about conveyance and application losses that nothing here measures.
        assert record["efficiency"] == 1.0
        assert 0 < record["kc"] <= 3
        assert 0 < record["root_depth_m"] <= 3
        assert 0 < record["depletion_fraction"] <= 1


def test_every_planning_record_carries_its_sources_and_a_quoted_window():
    """Crop calendars now exist, and each one says where it came from.

    This replaces an assertion that no `planning:` records existed. They were
    added deliberately: fifteen Punjab crops with sowing windows quoted from the
    PAU Package of Practices and durations and water needs from FAO. The test
    that guarded the gap now guards the provenance instead, so a record can
    never be added without one.
    """
    refs = reference_bundle()
    catalog = {row.id for row in refs.evidence}
    records = {k: v for k, v in refs.parameters.items() if k.startswith("planning:")}
    assert len(records) == 15
    for key, record in records.items():
        assert record["evidence_id"] in catalog, key
        assert record["evidence_id_water"] in catalog, key
        # A window without the sentence it came from cannot be checked by a
        # human later, which is the whole point of holding it as evidence.
        assert str(record["sowing_quote"]).strip(), key
        assert str(record["sowing_source"]).startswith("pau:"), key
        assert record["duration_min_days"] <= record["duration_max_days"], key
        assert record["seasonal_irrigation_low_mm"] <= record["seasonal_irrigation_mm"]
        assert record["seasonal_irrigation_mm"] <= record["seasonal_irrigation_high_mm"]
        # Cost of cultivation is region- and year-specific and was not
        # retrievable, so it is zero and names the gap rather than guessing.
        assert record["planned_cost_inr_ha"] == 0
        assert record["planned_cost_missing_reason"]


def test_region_bounds_exclude_crops_that_do_not_belong_to_the_demo_district():
    """Cotton is a south-west Punjab crop; IIT Ropar is not in that belt.

    The bounds are what make a recommendation honest rather than flattering: a
    ranking that offered cotton at Ropar would be wrong, and PAU does not
    recommend it there. Pinned so nobody widens the bounds to make more crops
    appear.
    """
    refs = reference_bundle()
    ropar_lat, ropar_lon = 30.9686, 76.4730

    def covers(crop: str) -> bool:
        record = refs.parameters[f"planning:{crop}"]
        return (record["latitude_min"] <= ropar_lat <= record["latitude_max"]
                and record["longitude_min"] <= ropar_lon <= record["longitude_max"])

    assert covers("wheat") and covers("rice") and covers("maize")
    assert covers("potato") and covers("sugarcane")
    assert not covers("cotton"), "cotton must not be offered outside the cotton belt"


def test_products_are_data_and_carry_no_efficacy_claim():
    """The engine reads a product catalogue; it never branches on a product name.

    Adding a biostimulant must be a reference change, so the catalogue is
    checked here rather than any list in code. What these records may say is
    bounded: positioning and application conditions, and never a figure for how
    much stress a product removes -- no such figure exists to record.
    """
    refs = reference_bundle()
    by_id = {row.id: row for row in refs.products}
    assert {"quantis", "isabion", "coucal"} <= set(by_id)

    # Exactly one product per crop, which is what the engine can act on. Two
    # eligible products is an ambiguity it reports rather than resolves.
    for crop in ("wheat", "maize", "rice", "cotton"):
        eligible = [row for row in refs.products if crop in row.crop_ids]
        assert len(eligible) == 1, f"{crop} has {len(eligible)} eligible products"

    # COUCAL is soil applied, so it has no spray window and claims no crop here.
    assert by_id["coucal"].crop_ids == []

    banned = ("efficacy", "percent_reduction", "stress_reduction", "yield_gain", "uplift")
    for key, record in refs.parameters.items():
        if not key.startswith("product:"):
            continue
        assert not [field for field in record if any(word in field for word in banned)], key


def test_a_product_record_states_that_it_is_not_an_approved_label():
    refs = reference_bundle()
    evidence = {row.id: row for row in refs.evidence}
    limits = evidence["syngenta:biostimulant-positioning"].limitations
    assert any("not an approved label" in line for line in limits)
    assert any("never a predicted reduction in stress" in line for line in limits)


def test_indicative_economics_are_a_band_and_declare_what_they_are():
    """Economics are answerable now, and answer as a scenario rather than a fact.

    A blank where a return should be is not neutral: a farmer choosing between
    crops cannot choose against nothing. So the bundle carries indicative yield,
    price and cost rows -- and they are resampled as paired rows, so the answer
    comes back as a p10-p90 band whose basis says "scenario" and whose evidence
    records that no agronomist has reviewed it.
    """
    refs = reference_bundle()
    keys = [key for key in refs.parameters if key.startswith("economics:")]
    assert len(keys) == 15
    result = economic_estimates("wheat", 1.0, refs, date(2026, 9, 10))
    assert result.profit.p50 is not None
    assert result.roi.p50 is not None
    assert result.profit.basis == "scenario"
    # A band, not a point: potato's price swing is real and must survive.
    potato = economic_estimates("potato", 1.0, refs, date(2026, 9, 10))
    assert potato.roi.p10 < potato.roi.p50 < potato.roi.p90
    evidence = {row.id: row for row in refs.evidence}
    limits = evidence["agrisense:indicative-economics-2025-26"].limitations
    assert any("not reviewed by an agronomist" in line for line in limits)


def test_a_farmers_own_ledger_still_outranks_the_indicative_figures():
    """Recorded reality replaces the scenario; it does not average with it."""
    refs = reference_bundle()
    with_ledger = economic_estimates("wheat", 1.0, refs, date(2026, 9, 10), has_actual_ledger=True)
    assert with_ledger.roi.p50 is None
    assert with_ledger.roi.missing_reason == "planned_actual_line_reconciliation_contract_required"


def test_weather_fetched_after_snapshot_preserves_facts_and_replays():
    snap = snapshot()
    before = snap.model_dump_json()
    weather = forecast(snap)
    weather.retrieved_at = snap.as_of + timedelta(seconds=30)
    result = evaluate_season(snap, weather, reference_bundle())
    assert result.recommendation.generated_at == weather.retrieved_at
    assert snap.model_dump_json() == before
    assert result == evaluate_season(snap, weather, reference_bundle())


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


def planning_case():
    """A planner case with one crop that fits the field and one that does not."""
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
    # Ranking weights and a regional suitability are both required now: the
    # planner reads them from the reference bundle rather than hardcoding a
    # constant, so a record without them is correctly rejected as invalid.
    refs.parameters["ranking_weights"] = {
        "suitability": 0.45, "water_fit": 0.20, "budget_fit": 0.20, "duration_fit": 0.15,
    }
    refs.parameters["planning:cotton"] = {
        **reviewed(),
        "regional_suitability": 0.8,
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
    return planning, refs, climate


def test_planner_returns_only_locally_evidenced_candidates():
    planning, refs, climate = planning_case()
    result = compare_crops(planning, refs, climate)
    assert [row.crop_id for row in result.candidates] == ["cotton"]
    assert any(row.facts["crop_id"] == "rice" for row in result.exclusions)
    assert result.candidates[0].water.seasonal.p50 == 2000
    planning.request.available_water_m3 = 1
    assert compare_crops(planning, refs, climate).candidates == []


def test_an_unstated_budget_does_not_exclude_a_crop():
    """Absence is not insufficiency.

    Both budgets are optional in the request, but absence used to exclude, so a
    farmer who had not said how much water or money they had got every crop
    excluded and an empty list back. That reads as "nothing grows on your land"
    rather than "you have not told us yet", which is the opposite of what the
    planner is for.
    """
    planning, refs, climate = planning_case()
    planning.request.available_water_m3 = None
    planning.request.budget_inr = None
    result = compare_crops(planning, refs, climate)

    assert [row.crop_id for row in result.candidates] == ["cotton"]
    assert not any(
        reason.code.startswith(("irrigation_budget", "cash_budget"))
        for reason in result.exclusions
    )
    # The dimension is dropped from the ranking, never scored as a perfect fit.
    compatibility = result.candidates[0].compatibility
    assert compatibility["water_fit"] is None and compatibility["budget_fit"] is None
    # Renormalised, so a score still means the same thing on the same 0-1 scale.
    assert compatibility["overall"] == pytest.approx(
        (0.45 * 0.8 + 0.15 * (1 - 140 / 730)) / 0.60
    )
    assert "water_fit_not_ranked_without_stated_water" in result.warnings
    assert "budget_fit_not_ranked_without_stated_budget" in result.warnings


def test_a_stated_budget_that_is_too_small_still_excludes():
    """The guard that matters is kept: a real constraint the crop fails."""
    planning, refs, climate = planning_case()
    planning.request.budget_inr = 1
    result = compare_crops(planning, refs, climate)
    assert result.candidates == []
    assert any(reason.code == "cash_budget_insufficient" for reason in result.exclusions)


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


def test_reference_files_are_discoverable_and_packaged():
    """The reference directory must be found, and must be shipped in the image.

    A hardcoded repo-relative path resolved to nothing inside the container, so
    every reviewed lookup failed and the API reported water as unavailable. That
    is the correct message for missing data and the wrong one for a missing
    `COPY`, and the two are indistinguishable from outside. This test asserts
    both that the directory resolves here and that the Dockerfile still copies
    it, because the second is what actually broke.
    """
    directory = reference_dir()
    assert directory is not None, "no reference directory resolved"
    for name in ("parameters.json", "crop-calendar.json", "PARAMETERS.md"):
        assert (directory / name).is_file(), f"{name} is missing from {directory}"

    dockerfile = Path(__file__).resolve().parents[2] / "Dockerfile"
    assert dockerfile.is_file()
    assert "COPY science/reference" in dockerfile.read_text(encoding="utf-8"), (
        "the API image no longer copies science/reference; reviewed parameters "
        "would silently be empty in production"
    )


def test_override_directory_is_honoured_and_validated(tmp_path, monkeypatch):
    """A deployment can mount a reviewed bundle without rebuilding the image.

    An override pointing somewhere that does not exist must yield no parameters
    rather than silently falling back to the packaged ones: a deployment that
    believes it is serving a reviewed regional bundle must not quietly serve the
    default instead.
    """
    from agrisense.science import references as module

    monkeypatch.setenv("AGRISENSE_REFERENCE_DIR", str(tmp_path / "absent"))
    assert module.reference_dir() is None

    (tmp_path / "parameters.json").write_text(
        json.dumps({"evidence": [], "parameters": {}}), encoding="utf-8"
    )
    monkeypatch.setenv("AGRISENSE_REFERENCE_DIR", str(tmp_path))
    assert module.reference_dir() == tmp_path


def test_duplicate_parameter_key_is_refused(tmp_path, monkeypatch):
    """One reference file must not silently overwrite another's value.

    A reference number replaced behind everyone's back is the kind of change
    nobody notices until the advice is wrong, so it is a load-time error.
    """
    from agrisense.science import references as module

    body = {"reviewed": True, "evidence_id": "e1", "valid_from": "2026-01-01",
            "valid_until": "2036-12-31", "kc": 1.0}
    evidence = [{"id": "e1", "kind": "k", "title": "t", "source": "s", "limitations": []}]
    (tmp_path / "parameters.json").write_text(
        json.dumps({"evidence": evidence, "parameters": {"water:rice": body}}), encoding="utf-8"
    )
    (tmp_path / "crop-calendar.json").write_text(
        json.dumps({"evidence": [], "parameters": {"water:rice": body}}), encoding="utf-8"
    )
    monkeypatch.setenv("AGRISENSE_REFERENCE_DIR", str(tmp_path))
    module._load.cache_clear()
    try:
        with pytest.raises(ValueError, match="duplicate parameter key"):
            module.reference_bundle()
    finally:
        module._load.cache_clear()


def _card_and_probe(card_id: str, probe_id: str):
    """A Soil Health Card and a probe reading on the same day, as a farmer has."""
    snap = snapshot()
    now = snap.as_of.date()
    card = api.SoilObservation(
        id=card_id, field_id=snap.field.id, sampled_on=now,
        ph=measurement(7.2, "pH"), organic_carbon=measurement(0.45, "%"),
        source="farmer", confirmation_state="confirmed", version=1,
    )
    probe = api.SoilObservation(
        id=probe_id, field_id=snap.field.id, sampled_on=now,
        moisture=measurement(0.20, "m³/m³"), moisture_basis="volumetric", depth_cm=30,
        source="farmer", confirmation_state="confirmed", version=1,
    )
    return snap.field.id, now, [card, probe]


@pytest.mark.parametrize(("card_id", "probe_id"), [("aaaa", "zzzz"), ("zzzz", "aaaa")])
def test_a_soil_health_card_cannot_shadow_the_moisture_reading(card_id, probe_id):
    """Whether the water plan worked came down to a random id.

    A photographed card and a probe reading are both stored as
    `source='farmer'` and both dated the day they were taken, so the only thing
    separating them in `select_soil` was its tiebreak on `id`. The card carries
    chemistry and no moisture, so when it won, the balance was handed a record
    that could not start it and every day read "no soil moisture reading taken
    today" — to a farmer looking at the reading they had just entered. Adding
    another reading could not help: the card kept winning.

    Both id orderings must select the reading with moisture in it.
    """
    from agrisense.science.references import select_soil_moisture

    field_id, now, observations = _card_and_probe(card_id, probe_id)
    chosen = select_soil_moisture(observations, field_id, now)
    assert chosen is not None, "a usable reading was on record and was not found"
    assert chosen.id == probe_id
    assert chosen.moisture is not None and chosen.moisture.value == 0.20


def test_a_reading_in_an_unusable_basis_never_displaces_one_that_works():
    """Only a volumetric m³/m³ reading can start a balance.

    The form accepts the other two bases so the reading is not lost, and says
    they are not usable yet. A later gravimetric entry must not push aside the
    volumetric one the balance can actually use, or entering more information
    would leave the farmer with less.
    """
    from datetime import timedelta as _timedelta

    from agrisense.science.references import select_soil_moisture

    field_id, now, observations = _card_and_probe("card", "probe")
    gravimetric = api.SoilObservation(
        id="later-gravimetric", field_id=field_id, sampled_on=now + _timedelta(days=1),
        moisture=measurement(0.18, "kg/kg"), moisture_basis="gravimetric",
        source="farmer", confirmation_state="confirmed", version=1,
    )
    chosen = select_soil_moisture([*observations, gravimetric], field_id, now + _timedelta(days=1))
    assert chosen is not None and chosen.id == "probe"


def test_an_unconfirmed_draft_reading_is_never_used():
    """An extraction awaiting the farmer's approval is a claim, not a fact."""
    from agrisense.science.references import select_soil_moisture

    field_id, now, observations = _card_and_probe("card", "probe")
    draft = observations[1].model_copy(update={"id": "draft", "confirmation_state": "draft"})
    assert select_soil_moisture([observations[0], draft], field_id, now) is None
