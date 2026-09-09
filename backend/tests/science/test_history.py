"""Synthetic history adapter fixtures; no forecast accuracy claim."""

from copy import deepcopy
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from agrisense.science.history import CODES, MeteoblueHistoryProvider, history_query, parse_history
from agrisense.science.providers import JsonTransport, ProviderUnavailable, build_weather_bundle

START, END = date(2026, 8, 1), date(2026, 8, 3)
NOW = datetime(2026, 9, 10, tzinfo=UTC)


def payload():
    return [
        {
            "domain": "ERA5T",
            "timeResolution": "daily",
            "timeIntervals": [["20260801T0000", "20260802T0000", "20260803T0000"]],
            "codes": [
                {
                    "code": code,
                    "aggregation": aggregation,
                    "level": level,
                    "unit": unit,
                    "dataPerTimeInterval": [{"data": [values]}],
                }
                for (code, aggregation, level, unit), values in zip(
                    CODES, ([35, 36, 37], [20, None, 22], [0, None, 4])
                )
            ],
        }
    ]


def test_history_retains_missingness_and_code_identity():
    data = payload()
    data[0]["codes"].reverse()
    bundle = parse_history(data, start=START, end=END, retrieved_at=NOW)
    assert bundle.daily[0].rain_mm == 0
    assert bundle.daily[1].rain_mm is None
    assert bundle.daily[1].tmin_c is None
    assert bundle.daily[0].tmax_c == 35
    assert bundle.daily[0].et0_mm is None
    assert bundle.mode == "estimated"
    assert not bundle.hours and bundle.issued_at is None
    assert "reanalysis_not_archived_forecast" in bundle.warnings


def test_history_rejects_bad_units_duplicate_dates_and_series():
    for kind in ("unit", "duplicate", "length", "domain", "null"):
        data = deepcopy(payload())
        if kind == "unit":
            data[0]["codes"][0]["unit"] = "°F"
        if kind == "duplicate":
            data[0]["timeIntervals"][0][1] = "20260801T0000"
        if kind == "length":
            data[0]["codes"][0]["dataPerTimeInterval"][0]["data"][0].pop()
        if kind == "domain":
            data[0]["domain"] = "NEMSGLOBAL"
        if kind == "null":
            for column in data[0]["codes"]:
                column["dataPerTimeInterval"][0]["data"][0] = [None] * 3
        with pytest.raises(ValueError):
            parse_history(data, start=START, end=END, retrieved_at=NOW)


def test_retained_query_is_bounded_and_uses_lon_lat():
    body = history_query(21.1, 79.1, START, END)
    assert body["geometry"]["coordinates"] == [[79.1, 21.1]]
    assert body["queries"][0]["gapFillDomain"] == "ERA5"
    with pytest.raises(ValueError):
        history_query(21.1, 79.1, END, START)
    with pytest.raises(ValueError):
        history_query(21.1, 79.1, date(2024, 1, 1), END)


@pytest.mark.asyncio
async def test_history_cannot_be_used_as_forecast_or_for_future_dates():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload()))
    ) as client:
        transport = JsonTransport(client=client, minimum_interval_seconds=0)
        provider = MeteoblueHistoryProvider(transport, api_key="synthetic-key")
        bundle = await provider.history((21.1, 79.1), START, END, NOW)
        assert len(bundle.daily) == 3
        with pytest.raises(ValueError):
            await provider.history((21.1, 79.1), START, NOW.date(), NOW)
        with patch.object(provider, "history", new=AsyncMock()) as history:
            forecast = await build_weather_bundle((21.1, 79.1), 10, NOW, providers=(provider,))
            history.assert_not_awaited()
        assert forecast.mode == "unavailable"


@pytest.mark.asyncio
async def test_queue_response_never_echoes_key():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"status": "waiting", "apikey": "synthetic-key"})
        )
    ) as client:
        provider = MeteoblueHistoryProvider(JsonTransport(client=client), api_key="synthetic-key")
        with pytest.raises(ProviderUnavailable) as caught:
            await provider.history((21.1, 79.1), START, END, NOW)
        assert caught.value.code == "history_job_requires_platform_worker"
        assert "synthetic-key" not in str(caught.value)


@pytest.mark.asyncio
async def test_legacy_history_never_invents_weather():
    from agrisense.clients.meteoblue import MeteoblueClient
    from agrisense.config import Settings

    client = MeteoblueClient(Settings(meteoblue_api_key="synthetic-key"))
    data = payload()
    data[0]["codes"][1]["dataPerTimeInterval"][0]["data"][0][1] = 21
    with patch.object(client, "_post", new=AsyncMock(return_value=data)):
        result = await client.history(21.1, 79.1, START, END)
    assert result.days[0].precipitation_mm == 0
    assert result.days[0].humidity_pct is None
    assert result.days[0].wind_kmh is None
    assert result.days[0].solar_wh_m2 is None
    assert result.days[1].precipitation_mm is None


@pytest.mark.asyncio
async def test_legacy_queue_uses_documented_result_host_and_validates_id():
    from agrisense.clients.meteoblue import MeteoblueClient, MeteoblueError
    from agrisense.config import Settings

    paths = []

    def respond(request):
        paths.append((request.url.host, request.url.path))
        return httpx.Response(
            200,
            json={"status": "finished"} if request.url.host == "my.meteoblue.com" else payload(),
        )

    legacy = MeteoblueClient(Settings())
    job_id = "12345678-1234-1234-1234-123456789012"
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        with patch("asyncio.sleep", new=AsyncMock()):
            result = await legacy._poll(client, job_id)
        assert result == payload()
        assert paths[-1] == ("queueresults.meteoblue.com", f"/{job_id}")
        with pytest.raises(MeteoblueError):
            await legacy._poll(client, "../../another-path")
