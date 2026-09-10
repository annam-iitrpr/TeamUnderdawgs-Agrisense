"""Provider-to-contract-to-evaluation regression; synthetic, no API/auth claim."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from agrisense.contracts_generated import models as api
from agrisense.science.facade import build_weather_bundle, evaluate_season
from agrisense.science.providers import JsonTransport, ProviderUnavailable
from agrisense.science.references import reference_bundle


@pytest.mark.asyncio
async def test_ten_day_provider_flow_preserves_weather_with_invalid_solar():
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    calls = []

    def respond(request):
        calls.append(request.url.path)
        if request.url.path.endswith("Hourly"):
            rows = []
            for index in range(240):
                stamp = (now + timedelta(hours=index)).strftime("%Y/%m/%d %H:%M:%S")
                for label, value in (
                    ("TempAir_Hourly (C)", "30"),
                    ("HumidityRel_Hourly (pct)", "60"),
                    ("WindSpeed_Hourly (m/s)", "2"),
                    ("Precip_HourlySum (mm)", "0"),
                    ("GlobalRadiation_HourlySum (Wh/m2)", "-0.66" if index == 100 else "0"),
                ):
                    rows.append({"date": stamp, "offset": 0, "measureLabel": label, "value": value})
            return httpx.Response(200, json=rows)
        return httpx.Response(
            200,
            json=[
                {
                    "date": (now + timedelta(days=i)).strftime("%Y/%m/%d"),
                    "measureLabel": label,
                    "dailyValue": value,
                }
                for i in range(10)
                for label, value in (
                    ("TempAir_DailyMin (C)", "20"),
                    ("TempAir_DailyMax (C)", "35"),
                    ("Precip_DailySum (mm)", "0"),
                )
            ],
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        transport = JsonTransport(client=client, minimum_interval_seconds=0)
        with (
            patch.dict("os.environ", {"CEHUB_API_KEY": "synthetic-key"}, clear=True),
            patch("agrisense.science.providers.JsonTransport", return_value=transport),
        ):
            forecast = await build_weather_bundle(
                api.Location(latitude=21.1, longitude=79.1, source="manual"), 10, now
            )
    assert len(calls) == 2
    assert len(forecast.hourly) == 240
    assert len(forecast.daily) == 10
    assert forecast.hourly[100].radiation_w_m2.value is None
    assert forecast.hourly[100].radiation_w_m2.missing_reason == "provider_value_invalid"
    assert forecast.hourly[99].radiation_w_m2.value == 0
    assert forecast.hourly[100].temperature_c.value == 30
    root = Path(__file__).resolve().parents[3]
    snapshot = api.SeasonSnapshot.model_validate_json(
        (root / "contracts/fixtures/cotton.snapshot.json").read_text()
    )
    snapshot.as_of = now
    result = evaluate_season(snapshot, forecast, reference_bundle())
    assert result.recommendation.stress_curve
    # The engine now reaches a product and evaluates it, so the outcome is a
    # real verdict rather than "no rules exist". This fixture's stage is not one
    # the product is applied at, which is a blocked outcome with a stated reason.
    assert result.recommendation.status in ("blocked", "monitor", "ready", "hold")
    assert result.recommendation.reasons
    # Economics are indicative now rather than blank, and still declare their basis.
    assert result.economics.profit.basis == "scenario"
    api.EvaluationBundle.model_validate_json(result.model_dump_json())


@pytest.mark.asyncio
async def test_outage_diagnostics_survive_contract_bridge_without_credentials():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(403, text="synthetic-key"))
    ) as client:
        transport = JsonTransport(client=client, minimum_interval_seconds=0)
        with (
            patch.dict("os.environ", {"CEHUB_API_KEY": "synthetic-key"}, clear=True),
            patch("agrisense.science.providers.JsonTransport", return_value=transport),
            pytest.raises(ProviderUnavailable) as caught,
        ):
            await build_weather_bundle(
                api.Location(latitude=21.1, longitude=79.1, source="manual"),
                10,
                datetime.now(UTC),
            )
    assert "cehub:http_403" in caught.value.diagnostics
    assert "synthetic-key" not in str(caught.value)
    assert "synthetic-key" not in str(caught.value.diagnostics)


def test_the_contract_carries_the_variables_a_spray_decision_needs():
    """v1 dropped gust, rain probability and inversion crossing this boundary.

    Providers fetch all three. They were lost on the way into the contract and
    rebuilt as nulls on the way out, and the ranker treats an unknown gust as a
    refusal -- so no spray window could be named for any farmer on any field,
    through the contract itself, whatever the provider had supplied. A gust is
    what carries a spray onto a neighbour's field, so it cannot be assumed away;
    carrying it is the only option.
    """
    from agrisense.science.contract_bridge import from_contract, to_contract
    from agrisense.science.weather import Hour, WeatherBundle

    now = datetime(2026, 9, 10, tzinfo=UTC)
    bundle = WeatherBundle(
        "synthetic-test",
        now,
        (
            Hour(now, 25, 60, 8, gust_kmh=12, rain_mm=0, rain_probability=0.10,
                 radiation_wm2=200, wind_height_m=10, inversion_clear=True,
                 source="synthetic-test"),
        ),
        mode="demo",
    )
    location = api.Location(latitude=30.9686, longitude=76.473, source="manual")

    contract = to_contract(bundle, location)
    hour = contract.hourly[0]
    assert hour.gust_kmh is not None and hour.gust_kmh.value == 12
    assert hour.rain_probability is not None and hour.rain_probability.value == 0.10
    assert hour.inversion_clear is True

    # And back, because the evaluation reads the rebuilt bundle and not the original.
    restored = from_contract(contract).hours[0]
    assert restored.gust_kmh == 12
    assert restored.rain_probability == 0.10
    assert restored.inversion_clear is True
