"""Unit tests for the stress equations, checked against the document's own examples."""

from __future__ import annotations

import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from agrisense.agronomy import constants as C
from agrisense.agronomy.constants import Crop
from agrisense.agronomy.stress import (
    accumulate_gdd,
    drought_index_percentile,
    drought_index_raw,
    frost_stress,
    growing_degree_days,
    heat_stress_diurnal,
    heat_stress_nocturnal,
    nitrogen_use_efficiency,
    phosphorus_use_efficiency,
    yield_risk,
)

ALL_CROPS = list(Crop)


def test_diurnal_zero_at_or_below_optimum():
    assert heat_stress_diurnal(32.0, Crop.COTTON).value == 0.0
    assert heat_stress_diurnal(20.0, Crop.COTTON).value == 0.0


def test_diurnal_nine_at_or_above_limit():
    assert heat_stress_diurnal(38.0, Crop.COTTON).value == 9.0
    assert heat_stress_diurnal(50.0, Crop.COTTON).value == 9.0


def test_diurnal_soybean_worked_example():
    """Page 2 prints: Diurnal heat stress for soybean = 9*[(TMAX - 32) / (45 - 32)]."""
    tmax = 38.5
    expected = 9 * ((tmax - 32) / (45 - 32))
    assert heat_stress_diurnal(tmax, Crop.SOYBEAN).value == pytest.approx(expected, abs=0.0001)


def test_diurnal_midpoint_is_half_scale():
    """Cotton optimum 32, limit 38. Midpoint 35 must land exactly on 4.5."""
    assert heat_stress_diurnal(35.0, Crop.COTTON).value == pytest.approx(4.5)


def test_diurnal_wheat_is_most_sensitive():
    """Wheat has the lowest cardinals (25 to 32), so it stresses first."""
    at_33 = {c: heat_stress_diurnal(33.0, c).value for c in ALL_CROPS}
    assert at_33[Crop.WHEAT] == 9.0
    assert at_33[Crop.COTTON] < 9.0


def test_diurnal_records_its_inputs():
    result = heat_stress_diurnal(35.0, Crop.RICE)
    assert result.inputs["tmax"] == 35.0
    assert result.inputs["tmax_optimum"] == 32.0
    assert result.inputs["tmax_limit"] == 38.0
    assert result.inputs["crop"] == "rice"


def test_nocturnal_uses_tmin_table_not_the_daytime_example():
    """The document's worked example wrongly reuses TMAX and 32/45.

    We implement the stated equation with TMIN and the TMin table. Rice TMin
    optimum is 22 and limit 28, so 25 degrees must be exactly half scale.
    """
    result = heat_stress_nocturnal(25.0, Crop.RICE)
    assert result.value == pytest.approx(4.5)
    assert result.inputs["constants_used"] == "tmin_constants"
    assert result.inputs["tmin_optimum"] == 22.0


def test_nocturnal_zero_below_optimum():
    assert heat_stress_nocturnal(21.9, Crop.RICE).value == 0.0


def test_nocturnal_capped_at_nine():
    """Page 3: if the nighttime heat stress is greater than 9, then use 9."""
    assert heat_stress_nocturnal(45.0, Crop.RICE).value == 9.0
    assert heat_stress_nocturnal(100.0, Crop.WHEAT).value == 9.0


def test_nocturnal_cotton_lower_threshold_than_rice():
    """Cotton TMin optimum is 20 against rice 22, so cotton stresses earlier."""
    assert heat_stress_nocturnal(21.0, Crop.COTTON).value > 0
    assert heat_stress_nocturnal(21.0, Crop.RICE).value == 0.0


@pytest.mark.parametrize("crop", [Crop.RICE, Crop.WHEAT])
def test_frost_is_none_for_rice_and_wheat(crop):
    """The source table records NA. None must never be rendered as zero risk."""
    result = frost_stress(-5.0, crop)
    assert result.value is None
    assert result.applicable is False
    assert "not applicable" in (result.note or "").lower()


def test_frost_worked_example_cotton():
    """Page 4: Frost stress = 9*[ABS(TMIN - 4) / ABS(-3 - 4)]."""
    tmin = 0.0
    expected = 9 * (abs(tmin - 4) / abs(-7))
    assert frost_stress(tmin, Crop.COTTON).value == pytest.approx(expected, abs=0.0001)


def test_frost_zero_above_trigger():
    """Page 3: if TMIN is more than 4 degrees, then there is no frost."""
    assert frost_stress(4.5, Crop.COTTON).value == 0.0
    assert frost_stress(20.0, Crop.CORN).value == 0.0


def test_frost_nine_at_or_below_frost_point():
    assert frost_stress(-3.0, Crop.COTTON).value == 9.0
    assert frost_stress(-10.0, Crop.COTTON).value == 9.0


def test_gdd_formula():
    """GDD = [(Tmax + Tmin) / 2] - Tbase. Wheat base is 0."""
    assert growing_degree_days(30.0, 10.0, Crop.WHEAT) == pytest.approx(20.0)


def test_gdd_floors_at_zero():
    """A cold day contributes nothing rather than erasing earlier growth."""
    assert growing_degree_days(5.0, -5.0, Crop.COTTON) == 0.0


def test_gdd_accumulates():
    days = [(30.0, 10.0)] * 5
    assert accumulate_gdd(days, Crop.WHEAT) == pytest.approx(100.0)


def test_drought_raw_follows_document_precedence():
    """DI = (P - E) + SM / T, with SM divided by T before the addition."""
    result = drought_index_raw(500.0, 300.0, 25.0, 500)
    assert result.value == pytest.approx((500 - 300) + (25 / 500))


def test_drought_percentile_inverts_rank():
    """A raw value below all history is the driest case, so stress is near 9."""
    history = (100.0, 200.0, 300.0, 400.0)
    dry = drought_index_percentile(50.0, history)
    assert dry.value == pytest.approx(9.0)
    wet = drought_index_percentile(500.0, history)
    assert wet.value == 0.0
    assert dry.value > wet.value


def test_drought_percentile_without_history_is_not_applicable():
    result = drought_index_percentile(10.0, [])
    assert result.value is None
    assert result.applicable is False


def test_drought_raw_survives_zero_temperature():
    """Must not raise on a division by zero."""
    assert drought_index_raw(10.0, 5.0, 20.0, 0.0).value is not None


def test_yield_risk_zero_inside_every_optimal_range():
    optima = C.YIELD_OPTIMA[Crop.RICE]
    result = yield_risk(
        optima.gdd.mid,
        optima.precipitation_mm.mid,
        optima.ph.mid,
        optima.nitrogen_g_per_kg.mid,
        Crop.RICE,
    )
    assert result.value == pytest.approx(0.0)


def test_yield_risk_normalisation_makes_ph_and_nitrogen_weights_meaningful():
    """This is the numeric demonstration referenced in the pitch.

    In the raw form, a pH deviation of 1.0 contributes 0.2 while a GDD deviation of
    500 contributes 75000, so w3 and w4 are numerically inert. Normalising each
    deviation against its own range first restores the intended 0.3/0.3/0.2/0.2
    balance. The test asserts the ratio, not just that the numbers differ.
    """
    crop = Crop.RICE
    optima = C.YIELD_OPTIMA[crop]

    gdd_dev_raw = 500.0
    ph_dev_raw = 1.0
    raw_gdd_term = C.YIELD_RISK_WEIGHTS["gdd"] * gdd_dev_raw**2
    raw_ph_term = C.YIELD_RISK_WEIGHTS["ph"] * ph_dev_raw**2
    assert (raw_gdd_term / raw_ph_term) > 100000, "raw form should drown out pH entirely"

    norm_gdd = min(gdd_dev_raw / optima.gdd.span, 1.0)
    norm_ph = min(ph_dev_raw / optima.ph.span, 1.0)
    norm_gdd_term = C.YIELD_RISK_WEIGHTS["gdd"] * norm_gdd**2
    norm_ph_term = C.YIELD_RISK_WEIGHTS["ph"] * norm_ph**2
    assert (norm_gdd_term / norm_ph_term) < 10, "normalised form keeps pH influential"


def test_yield_risk_reports_per_term_contributions():
    result = yield_risk(3000.0, 200.0, 8.0, 0.0, Crop.RICE)
    contributions = result.inputs["contributions"]
    assert set(contributions) == {"gdd", "precipitation", "ph", "nitrogen"}
    assert result.inputs["normalised"] is True
    assert result.value is not None
    assert result.value > 0


def test_yield_risk_stays_on_the_stress_scale_when_normalised():
    """Every stress in the product must share the same 0 to 9 scale."""
    result = yield_risk(0.0, 0.0, 14.0, 10.0, Crop.WHEAT)
    assert result.value is not None
    assert 0 <= result.value <= C.STRESS_SCALE_MAX


def test_nitrogen_nue_bands():
    high = nitrogen_use_efficiency(6000, 100, 1200, 80, Crop.RICE)
    assert high.inputs["band"] == "high"
    assert high.inputs["recommend_biostimulant"] is False

    low = nitrogen_use_efficiency(1000, 100, 1200, 80, Crop.RICE)
    assert low.inputs["band"] == "low"
    assert low.inputs["recommend_biostimulant"] is True


def test_nitrogen_nue_rainfall_factor_matches_document_example():
    """Page 7: if optimal rainfall is 600 and actual is 500, RF = 0.83."""
    result = nitrogen_use_efficiency(3000, 100, 500, 80, Crop.RICE)
    assert result.inputs["rainfall_factor"] == pytest.approx(0.5)


def test_nitrogen_nue_undefined_without_application():
    result = nitrogen_use_efficiency(3000, 0, 1200, 80, Crop.RICE)
    assert result.value is None
    assert result.applicable is False


def test_phosphorus_sf_divisor_flag_changes_the_cap():
    """The source divides three factors by four, capping SF at 0.75."""
    assert C.PHOSPHORUS_SF_DIVISOR == 3.0, "default should be the corrected divisor"
    result = phosphorus_use_efficiency(5.0, 30.0, 6.0, 80.0, 1200.0, Crop.RICE)
    assert result.inputs["soil_factor"] == pytest.approx(1.0)


def test_phosphorus_nue_bands():
    excellent = phosphorus_use_efficiency(10.0, 20.0, 6.0, 80.0, 1200.0, Crop.RICE)
    assert excellent.inputs["band"] == "excellent"

    low = phosphorus_use_efficiency(0.5, 100.0, 6.0, 80.0, 1200.0, Crop.RICE)
    assert low.inputs["band"] == "low"
    assert low.inputs["recommend_biostimulant"] is True


def test_phosphorus_undefined_without_application():
    assert phosphorus_use_efficiency(5.0, 0.0, 6.0, 80.0, 1200.0, Crop.RICE).value is None


@given(tmax=st.floats(-30, 60), crop=st.sampled_from(ALL_CROPS))
@settings(max_examples=200)
def test_diurnal_always_within_scale(tmax, crop):
    value = heat_stress_diurnal(tmax, crop).value
    assert value is not None
    assert 0 <= value <= 9.0


@given(tmin=st.floats(-30, 60), crop=st.sampled_from(ALL_CROPS))
@settings(max_examples=200)
def test_nocturnal_always_within_scale(tmin, crop):
    value = heat_stress_nocturnal(tmin, crop).value
    assert value is not None
    assert 0 <= value <= 9.0


@given(tmin=st.floats(-40, 40), crop=st.sampled_from(ALL_CROPS))
@settings(max_examples=200)
def test_frost_within_scale_or_none(tmin, crop):
    value = frost_stress(tmin, crop).value
    assert value is None or 0 <= value <= 9.0


@given(
    gdd=st.floats(0, 6000),
    precip=st.floats(0, 4000),
    ph=st.floats(3, 10),
    n=st.floats(0, 1),
    crop=st.sampled_from(ALL_CROPS),
)
@settings(max_examples=200)
def test_yield_risk_within_scale(gdd, precip, ph, n, crop):
    value = yield_risk(gdd, precip, ph, n, crop).value
    assert value is not None
    assert 0 <= value <= 9.0
    assert not math.isnan(value)


@given(tmax=st.floats(-20, 55), tmin=st.floats(-20, 55), crop=st.sampled_from(ALL_CROPS))
@settings(max_examples=200)
def test_gdd_never_negative(tmax, tmin, crop):
    assert growing_degree_days(tmax, tmin, crop) >= 0.0


def test_every_india_crop_has_a_full_constant_set():
    """Guards against a crop being added without its cardinal temperatures."""
    for crop in C.INDIA_CROPS:
        assert crop in C.CARDINALS
        assert crop in C.YIELD_OPTIMA
        assert crop in C.GDD_BASE_TEMPERATURE_C
        assert crop in C.GROWTH_STAGES
        assert crop in C.YIELD_BOOSTER_STAGES
