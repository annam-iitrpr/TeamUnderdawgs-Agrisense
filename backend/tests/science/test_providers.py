import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import httpx

from agrisense.science.providers import (
    JsonTransport,
    ProviderUnavailable,
    build_weather_bundle,
    parse_cehub,
    parse_openmeteo,
)

NOW = datetime(2026, 9, 10, tzinfo=UTC)


class NormalizationTests(unittest.TestCase):
    def ce(self, value="2", label="WindSpeed_Hourly (m/s)"):
        return {"date": "2026/09/10 05:30:00", "offset": 5.5, "measureLabel": label, "value": value}

    def test_ce_offset_units_and_unknowns(self):
        bundle = parse_cehub(
            [self.ce()], retrieved_at=NOW, start_at=NOW, end_at=NOW + timedelta(days=1)
        )
        self.assertEqual(bundle.hours[0].start_at, NOW)
        self.assertEqual(bundle.hours[0].wind_kmh, 7.2)
        self.assertEqual(bundle.hours[0].wind_height_m, 2)
        self.assertIsNone(bundle.hours[0].rain_mm)
        self.assertIsNone(bundle.issued_at)
        self.assertIn("interval_semantics_unconfirmed", bundle.warnings)

    def test_ce_rejects_conflicting_or_nonfinite(self):
        for records in ([self.ce(), self.ce()], [self.ce("NaN")], [self.ce("-1")]):
            with self.assertRaises(ValueError):
                parse_cehub(records, retrieved_at=NOW, start_at=NOW, end_at=NOW + timedelta(days=1))

    def test_invalid_solar_measurement_preserves_other_weather(self):
        from agrisense.contracts_generated.models import Location
        from agrisense.science.contract_bridge import to_contract

        for invalid in ("-0.66", "-0.37", "NaN", "inf", "1700", "invalid"):
            bundle = parse_cehub(
                [self.ce(), self.ce(invalid, "GlobalRadiation_HourlySum (Wh/m2)")],
                retrieved_at=NOW,
                start_at=NOW,
                end_at=NOW + timedelta(days=10),
            )
            self.assertEqual(bundle.hours[0].wind_kmh, 7.2)
            self.assertIsNone(bundle.hours[0].radiation_wm2)
            self.assertIn("invalid_radiation_measurements", bundle.warnings)
            contract = to_contract(bundle, Location(latitude=21.1, longitude=79.1, source="manual"))
            self.assertEqual(
                contract.hourly[0].radiation_w_m2.missing_reason, "provider_value_invalid"
            )

    def test_zero_solar_is_a_valid_measurement(self):
        bundle = parse_cehub(
            [self.ce("0", "GlobalRadiation_HourlySum (Wh/m2)")],
            retrieved_at=NOW,
            start_at=NOW,
            end_at=NOW + timedelta(days=1),
        )
        self.assertEqual(bundle.hours[0].radiation_wm2, 0)
        self.assertNotIn("invalid_radiation_measurements", bundle.warnings)

    def test_openmeteo_preceding_hour_shift(self):
        data = {
            "utc_offset_seconds": 0,
            "hourly": {
                "time": [NOW.timestamp(), NOW.timestamp() + 3600],
                "precipitation": [0, 4],
                "wind_gusts_10m": [5, 20],
                "temperature_2m": [20, 21],
            },
            "hourly_units": {
                "precipitation": "mm",
                "wind_gusts_10m": "km/h",
                "temperature_2m": "°C",
            },
        }
        bundle = parse_openmeteo(data, NOW)
        self.assertEqual(bundle.hours[0].rain_mm, 4)
        self.assertEqual(bundle.hours[0].gust_kmh, 20)
        self.assertEqual(bundle.hours[0].temperature_c, 20)
        self.assertIsNone(bundle.hours[1].rain_mm)
        data["hourly_units"]["precipitation"] = "inch"
        with self.assertRaises(ValueError):
            parse_openmeteo(data, NOW)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_204_auth_and_redirect_no_retry_or_secret_echo(self):
        for code in (204, 401, 403, 302):
            calls = []

            def respond(request, calls=calls, code=code):
                calls.append(request)
                return httpx.Response(code, text="private credentialed provider error")

            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                transport = JsonTransport(client=client, minimum_interval_seconds=0)
                with self.assertRaises(ProviderUnavailable) as caught:
                    await transport.request(
                        "test", "GET", "https://example.test", params={"apikey": "local-secret"}
                    )
                self.assertNotIn("local-secret", str(caught.exception))
                self.assertEqual(len(calls), 1)

    async def test_retry_and_circuit(self):
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(503))
        ) as client:
            transport = JsonTransport(client=client, attempts=2, minimum_interval_seconds=0)
            with patch("agrisense.science.providers.asyncio.sleep", new=AsyncMock()):
                with self.assertRaises(ProviderUnavailable):
                    await transport.request("test", "GET", "https://example.test")
                with self.assertRaisesRegex(ProviderUnavailable, "circuit_open"):
                    await transport.request("test", "GET", "https://example.test")

    async def test_retry_after_and_large_payload(self):
        for response, reason in (
            (httpx.Response(429, headers={"Retry-After": "120"}), "retry_after"),
            (httpx.Response(200, content=b"x" * 100), "payload_too_large"),
        ):
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(lambda _, response=response: response)
            ) as client:
                transport = JsonTransport(
                    client=client, max_payload_bytes=20, minimum_interval_seconds=0
                )
                with self.assertRaisesRegex(ProviderUnavailable, reason):
                    await transport.request("test", "GET", "https://example.test")

    async def test_unconfigured_is_unavailable_no_demo(self):
        result = await build_weather_bundle((30, 76), 2, NOW, providers=())
        self.assertEqual(result.mode, "unavailable")
        self.assertEqual(result.hours, ())


if __name__ == "__main__":
    unittest.main()
