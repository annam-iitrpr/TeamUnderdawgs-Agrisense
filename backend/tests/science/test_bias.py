from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from agrisense.science.bias import WeatherPair, apply_bias, fit_bias


def pair(value, observed):
    issue = datetime(2026, 1, 1, tzinfo=UTC)
    return WeatherPair(
        issue,
        issue + timedelta(days=1),
        issue + timedelta(days=2),
        value,
        observed,
        "temperature_c",
        "synthetic-station",
        True,
        True,
    )


def test_bias_cutoff_bounds_and_quality():
    row = pair(20, 22)
    kwargs = {
        "cutoff": datetime(2026, 2, 1, tzinfo=UTC),
        "variable": "temperature_c",
        "lead_min_hours": 0,
        "lead_max_hours": 48,
        "max_abs_offset": 1,
    }
    candidate = fit_bias((row,), **kwargs)
    assert candidate["offset"] == 1
    assert candidate["raw_offset"] == 2
    assert apply_bias(20, candidate) == 21
    assert fit_bias((replace(row, qc_passed=False),), **kwargs)["offset"] is None
    with pytest.raises(ValueError):
        fit_bias((replace(row, observation_available_at=kwargs["cutoff"]),), **kwargs)
    with pytest.raises(ValueError):
        fit_bias((row, row), **kwargs)


def test_rain_mapping_preserves_dry_zero_and_refuses_tails():
    candidate = {
        "offset": -2,
        "variable": "rain_mm",
        "forecast_knots": [0, 1, 2],
        "observation_knots": [0, 2, 3],
    }
    assert apply_bias(1, candidate) == 0
    assert apply_bias(0, candidate, method="quantile_mapping") == 0
    assert apply_bias(10, candidate, method="quantile_mapping") is None
