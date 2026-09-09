from datetime import UTC, datetime, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from agrisense.science.providers import parse_cehub_daily
from agrisense.science.units import area_to_ha, irrigation_litres
from agrisense.science.water import RootZone, root_zone_day
from agrisense.science.weather import Hour, WeatherBundle
from agrisense.science.windows import Candidate, SprayPolicy, rank_windows


@given(depth=st.floats(0, 1000, allow_nan=False), area=st.floats(0.001, 10000, allow_nan=False))
def test_irrigation_scales_with_allocated_area(depth, area):
    assert irrigation_litres(depth, area * 2) == pytest.approx(2 * irrigation_litres(depth, area))


@given(rain=st.floats(0, 200, allow_nan=False), extra=st.floats(0, 200, allow_nan=False))
def test_more_rain_does_not_increase_root_zone_depletion(rain, extra):
    zone = RootZone(0.3, 0.1, 1, 0.5, 0.8)
    kwargs = {"depletion_mm": 100, "et0_mm": 5, "kc": 1, "area_ha": 1}
    original = root_zone_day(zone, rain_mm=rain, **kwargs)
    wetter = root_zone_day(zone, rain_mm=rain + extra, **kwargs)
    assert 0 <= wetter["depletion_mm"] <= original["depletion_mm"] <= zone.taw


def test_acre_conversion_and_daily_cehub_null_et0():
    assert area_to_ha(1, "acre") == pytest.approx(0.40468564224)
    rows = [
        {"date": "2026/09/10 00:00:00", "measureLabel": label, "dailyValue": value}
        for label, value in (
            ("TempAir_DailyMin (C)", "20"),
            ("TempAir_DailyMax (C)", "35"),
            ("Precip_DailySum (mm)", "0"),
        )
    ]
    days = parse_cehub_daily(rows)
    assert days[0].tmax_c == 35
    assert days[0].rain_mm == 0
    assert days[0].et0_mm is None
    with pytest.raises(ValueError):
        parse_cehub_daily(rows + rows)


def test_zero_timing_fit_never_produces_recommendation():
    now = datetime(2026, 9, 10, tzinfo=UTC)
    weather = WeatherBundle(
        "synthetic",
        now,
        tuple(
            Hour(now + timedelta(hours=i), 25, 60, 8, 12, 0, 0.1, 200, 10, True, "synthetic")
            for i in range(8)
        ),
        mode="demo",
    )
    policy = SprayPolicy("synthetic", True, 3, 15, 20, 10, 2, 8, 10, 35, 0, 0.2, 4)
    result = rank_windows(
        weather,
        (Candidate(now, now + timedelta(hours=2), 1, 0),),
        policy,
        as_of=now,
        area_ha=1,
        capacity_ha_hour=1,
    )
    assert result["status"] == "blocked"
    assert result["selected_window"] is None
