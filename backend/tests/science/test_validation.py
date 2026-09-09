from datetime import UTC, date, datetime, timedelta

import pytest

from agrisense.science.validation import (
    YieldSample,
    conformal_radius,
    interval_metrics,
    promotion_gate,
    regression_metrics,
    split_forward_grouped,
)


def sample(identifier, year, farmer=None):
    start = datetime(year, 1, 1, tzinfo=UTC)
    return YieldSample(
        str(identifier),
        farmer or str(identifier),
        str(identifier),
        "cotton",
        "synthetic-district",
        start.date(),
        start + timedelta(days=1),
        start,
        start + timedelta(days=120),
        1000,
        900,
        (1, None),
        "synthetic_software_test",
    )


def test_forward_split_excludes_farmer_leakage():
    rows = (sample(1, 2022), sample(2, 2023), sample(3, 2024), sample(4, 2022, "3"))
    splits = split_forward_grouped(
        rows, calibration_start=date(2023, 1, 1), test_start=date(2024, 1, 1)
    )
    assert [row.sample_id for row in splits["train"]] == ["1"]
    assert [row.sample_id for row in splits["calibration"]] == ["2"]
    assert [row.sample_id for row in splits["test"]] == ["3"]
    assert rows[0].residual_kg_ha == -100


def test_independent_metrics_zero_outcome_and_conformal_size():
    metrics = regression_metrics((0, 10), (2, 6))
    assert metrics["mae"] == 3
    assert metrics["bias"] == -1
    assert metrics["rmse"] == pytest.approx(10**0.5)
    assert interval_metrics((0, 10), (0, 8), (1, 12))["coverage"] == 1
    assert conformal_radius((1,), (2,)) is None
    assert conformal_radius((0, 0, 0, 0), (1, 2, 3, 4)) == 4


def test_synthetic_model_cannot_be_promoted():
    gate = promotion_gate(
        dataset_kind="synthetic_software_test",
        candidate_mae=1,
        baseline_mae=2,
        empirical_coverage=0.9,
        minimum_coverage=0.8,
        subgroup_regressions=[],
        reviewer_id="reviewer",
        evaluation_hash="hash",
        hard_violations=0,
    )
    assert gate["eligible_for_promotion"] is False
    assert gate["automatic_promotion"] is False


def test_future_features_rejected():
    from dataclasses import replace

    row = sample(1, 2022)
    with pytest.raises(ValueError):
        replace(row, features_available_at=row.harvest_at)


def test_late_confirmed_label_excluded_from_training():
    from dataclasses import replace

    late = replace(sample(4, 2022), label_available_at=datetime(2025, 1, 1, tzinfo=UTC))
    rows = (sample(1, 2022), sample(2, 2023), sample(3, 2024), late)
    splits = split_forward_grouped(
        rows, calibration_start=date(2023, 1, 1), test_start=date(2024, 1, 1)
    )
    assert [row.sample_id for row in splits["train"]] == ["1"]
    with pytest.raises(ValueError):
        replace(sample(5, 2022), source_kind="confirmed_field_outcome")
