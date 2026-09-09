"""Regression reproductions for unsafe inherited shortcuts during facade migration."""

from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, patch

import pytest

from agrisense.agronomy.constants import Crop
from agrisense.agronomy.projection import project_stress
from agrisense.agronomy.scoring import estimate_value
from agrisense.agronomy.stress import drought_index_raw, nitrogen_use_efficiency
from agrisense.agronomy.types import DailyWeather, FieldContext, HourlyWeather
from agrisense.agronomy.viability import SprayWindow, spray_viability
from agrisense.clients.cehub import CEHubError, CEHubForecastClient
from agrisense.clients.openmeteo import _required
from agrisense.clients.resolver import ForecastResolver
from agrisense.config import DataMode, Settings


def test_legacy_zero_temperature_does_not_invent_a_denominator():
    assert drought_index_raw(10, 5, 20, 0).value is None


def test_nutrient_index_is_not_a_product_prescription():
    assert (
        nitrogen_use_efficiency(1000, 100, 1200, 80, Crop.RICE).inputs["recommend_biostimulant"]
        is False
    )


def test_no_stress_days_to_rupees_or_dimensional_drought_advice():
    context = FieldContext("cotton", 21, 79, 1, date(2026, 6, 1), 6.2)
    weather = [DailyWeather(date(2026, 9, 9), 38, 25, 0, 60, 8, 5000)]
    projection = project_stress(context, weather, history_drought=[10, 20, 30])
    start = datetime(2026, 9, 9, 6, tzinfo=UTC)
    window = SprayWindow(start, start.replace(hour=8), 0.8, 2)
    assert estimate_value(projection, window, Crop.COTTON, 1) is None
    assert projection.days[0].scores["drought"] is None


@pytest.mark.asyncio
async def test_live_outage_returns_unavailable_not_fixture():
    resolver = ForecastResolver(Settings(agrisense_data_mode=DataMode.LIVE))
    with (
        patch(
            "agrisense.clients.resolver.CEHubForecastClient.daily",
            new=AsyncMock(side_effect=RuntimeError("private")),
        ),
        patch(
            "agrisense.clients.resolver.OpenMeteoForecastClient.daily",
            new=AsyncMock(side_effect=RuntimeError("private")),
        ),
    ):
        result = await resolver._daily(30, 76, 2)
    assert result.days == []
    assert result.provenance.source == "unavailable"


@pytest.mark.asyncio
async def test_legacy_cehub_missing_weather_never_gets_constants():
    client = CEHubForecastClient(Settings())
    payload = {
        "tmax_c": {datetime(2026, 9, 9, tzinfo=UTC): 35},
        "tmin_c": {datetime(2026, 9, 9, tzinfo=UTC): 20},
    }
    with (
        patch.object(client, "_gather", new=AsyncMock(return_value=payload)),
        pytest.raises(CEHubError),
    ):
        await client.daily(30, 76, 1)


def test_legacy_shape_cannot_certify_reviewed_product_safety():
    hours = [
        HourlyWeather(datetime(2026, 9, 9, h, tzinfo=UTC), 25, 60, 8, 0, 200) for h in range(16)
    ]
    assert spray_viability(hours).best_window is None


def test_legacy_openmeteo_missing_is_not_zero_and_zero_is_preserved():
    assert _required({"rain": [0]}, "rain", 0) == 0
    with pytest.raises(ValueError):
        _required({"rain": [None]}, "rain", 0)
    with pytest.raises(ValueError):
        _required({}, "humidity", 0)


@pytest.mark.asyncio
async def test_explicit_mock_makes_no_live_calls():
    resolver = ForecastResolver(Settings(agrisense_data_mode=DataMode.MOCK))
    with patch(
        "agrisense.clients.resolver.OpenMeteoForecastClient.daily", new=AsyncMock()
    ) as provider:
        result = await resolver._daily(30, 76, 1)
    provider.assert_not_awaited()
    assert result.provenance.live is False
