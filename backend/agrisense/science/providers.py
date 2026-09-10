"""Bounded asynchronous weather IO, separate from pure request-time science.

CE Hub field names verified against a live Metadata/hourly probe on 2026-09-10.
Unconfirmed issue-time semantics remain unknown, even when modelUpdateTime exists.
"""

import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from random import random
from time import monotonic
from typing import Any, Protocol

import httpx

from .units import finite, radiation_wm2, wind_kmh
from .weather import Daily, Hour, WeatherBundle, utc


class ProviderUnavailable(Exception):
    """Only safe codes cross the provider boundary; never expose credentialed URLs."""

    def __init__(self, provider: str, code: str, diagnostics: tuple[str, ...] = ()):
        self.provider, self.code = provider, code
        self.diagnostics = diagnostics
        super().__init__(f"{provider}: {code}")


class JsonTransport:
    def __init__(
        self,
        *,
        client: httpx.AsyncClient | None = None,
        attempts: int = 3,
        minimum_interval_seconds: float = 1,
        circuit_seconds: float = 60,
        max_payload_bytes: int = 8_000_000,
    ):
        if not 1 <= attempts <= 4 or minimum_interval_seconds < 0 or max_payload_bytes < 1:
            raise ValueError("invalid bounded transport policy")
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(20, connect=5),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
            follow_redirects=False,
        )
        self.owns_client = client is None
        self.attempts = attempts
        self.minimum_interval = minimum_interval_seconds
        self.circuit_seconds = circuit_seconds
        self.max_payload_bytes = max_payload_bytes
        self.next_request = 0.0
        self.open_until = 0.0
        self.failures = 0
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        if self.owns_client:
            await self.client.aclose()

    async def request(self, provider: str, method: str, url: str, **kwargs: Any) -> Any:
        if not url.startswith("https://"):
            raise ProviderUnavailable(provider, "https_required")
        for attempt in range(self.attempts):
            if monotonic() < self.open_until:
                raise ProviderUnavailable(provider, "circuit_open")
            async with self.lock:
                await asyncio.sleep(max(0, self.next_request - monotonic()))
                self.next_request = monotonic() + self.minimum_interval
            delay = min(2**attempt + random(), 5)
            code = "transport_failure"
            try:
                async with self.client.stream(method, url, **kwargs) as response:
                    status = response.status_code
                    if status == 204:
                        raise ProviderUnavailable(provider, "no_data")
                    if status in (408, 429) or 500 <= status <= 599:
                        code = f"http_{status}"
                        retry = response.headers.get("Retry-After")
                        if retry:
                            try:
                                delay = max(0, float(retry))
                            except ValueError:
                                try:
                                    delay = max(
                                        0,
                                        (
                                            parsedate_to_datetime(retry) - datetime.now(UTC)
                                        ).total_seconds(),
                                    )
                                except (ValueError, TypeError):
                                    pass
                            if delay > 30:
                                self.open_until = monotonic() + delay
                                raise ProviderUnavailable(
                                    provider, "retry_after_exceeds_request_budget"
                                )
                    elif not 200 <= status < 300:
                        raise ProviderUnavailable(provider, f"http_{status}")
                    else:
                        content = bytearray()
                        async for chunk in response.aiter_bytes():
                            content.extend(chunk)
                            if len(content) > self.max_payload_bytes:
                                raise ProviderUnavailable(provider, "payload_too_large")
                        try:
                            result = json.loads(content)
                        except (ValueError, UnicodeDecodeError):
                            raise ProviderUnavailable(provider, "invalid_json") from None
                        self.failures = 0
                        return result
            except httpx.TransportError:
                # Do not propagate HTTPX exception messages; they can contain API keys.
                code = "transport_failure"
            self.failures += 1
            if self.failures >= self.attempts:
                self.open_until = monotonic() + self.circuit_seconds
            if attempt + 1 < self.attempts:
                await asyncio.sleep(delay)
        raise ProviderUnavailable(provider, code)


class WeatherProvider(Protocol):
    name: str
    capabilities: frozenset[str]

    async def forecast(
        self, location: tuple[float, float], horizon: int, as_of: datetime
    ) -> WeatherBundle: ...


CE_LABELS = {
    "TempAir_Hourly (C)": "temperature_c",
    "HumidityRel_Hourly (pct)": "rh_percent",
    "Precip_HourlySum (mm)": "rain_mm",
    "WindSpeed_Hourly (m/s)": "wind_kmh",
    "WindGust_Hourly (m/s)": "gust_kmh",
    "PrecipProbability_Hourly (pct)": "rain_probability",
    "GlobalRadiation_HourlySum (Wh/m2)": "radiation_wm2",
}


def payload_hash(payload: Any) -> str:
    return sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def parse_cehub(
    payload: Any, *, retrieved_at: datetime, start_at: datetime, end_at: datetime
) -> WeatherBundle:
    if not isinstance(payload, list) or not payload:
        raise ValueError("CE Hub returned no records")
    rows: dict[datetime, dict[str, Any]] = {}
    seen: set[tuple[datetime, str]] = set()
    invalid_radiation = False
    for record in payload:
        label = record.get("measureLabel")
        if label not in CE_LABELS:
            continue
        offset = finite(float(record["offset"]), "UTC offset", -12, 14)
        local = datetime.strptime(record["date"], "%Y/%m/%d %H:%M:%S").replace(
            tzinfo=timezone(timedelta(hours=offset))
        )
        timestamp = utc(local)
        identity = (timestamp, label)
        if identity in seen:
            raise ValueError("duplicate CE Hub timestamp/variable")
        seen.add(identity)
        if not utc(start_at) <= timestamp < utc(end_at):
            continue
        # `value` was observed live. Other variants require separate verified fixtures.
        raw = record.get("value")
        field = CE_LABELS[label]
        if field == "radiation_wm2":
            # Live long-horizon CE Hub responses contain negative solar energy.
            # Reject that measurement, not the independently valid weather series.
            try:
                value = None if raw is None or raw == "" else radiation_wm2(float(raw), 1)
                if value is not None:
                    finite(value, "radiation", 0, 1600)
            except (ValueError, TypeError):
                value = None
                invalid_radiation = True
                rows.setdefault(timestamp, {})["radiation_missing_reason"] = (
                    "provider_value_invalid"
                )
        else:
            value = None if raw is None or raw == "" else float(raw)
        if value is not None:
            if field in ("wind_kmh", "gust_kmh"):
                value = wind_kmh(value, "m/s")
            elif field == "rain_probability":
                value /= 100
        rows.setdefault(timestamp, {})[field] = value
    if not rows:
        raise ValueError("no hourly coverage in requested interval")
    hours = tuple(
        Hour(timestamp, **values, wind_height_m=2, source="cehub:Meteoblue")
        for timestamp, values in rows.items()
    )
    return WeatherBundle(
        "cehub:Meteoblue",
        retrieved_at,
        hours,
        raw_payload_hash=payload_hash(payload),
        warnings=(
            "provider_local_time_interpreted_using_offset",
            "grid_resolution_unknown",
            "model_update_time_semantics_unconfirmed",
            "interval_semantics_unconfirmed",
            "inversion_requires_field_verification",
        )
        + (("invalid_radiation_measurements",) if invalid_radiation else ()),
        variable_sources=tuple((field, "cehub:Meteoblue") for field in CE_LABELS.values()),
    )


CE_DAILY_LABELS = {
    "TempAir_DailyMin (C)": "tmin_c",
    "TempAir_DailyMax (C)": "tmax_c",
    "Precip_DailySum (mm)": "rain_mm",
}


def parse_cehub_daily(payload: Any) -> tuple[Daily, ...]:
    from datetime import date

    if not isinstance(payload, list) or not payload:
        raise ValueError("CE Hub daily response has no records")
    rows = {}
    for record in payload:
        label = record.get("measureLabel")
        if label not in CE_DAILY_LABELS:
            continue
        day = date.fromisoformat(str(record["date"])[:10].replace("/", "-")).isoformat()
        field = CE_DAILY_LABELS[label]
        values = rows.setdefault(day, {})
        if field in values:
            raise ValueError("duplicate CE Hub daily date/variable")
        value = record.get("dailyValue")
        values[field] = None if value is None or value == "" else float(value)
    # Evapotranspiration_DailySum is not verified reference ET0; keep ET0 unknown.
    return tuple(
        Daily(
            day,
            values.get("tmin_c"),
            values.get("tmax_c"),
            values.get("rain_mm"),
            None,
            "cehub:Meteoblue",
        )
        for day, values in sorted(rows.items())
    )


class CEHubProvider:
    name = "cehub"
    capabilities = frozenset({"forecast_hourly", "forecast_daily"})

    def __init__(
        self,
        transport: JsonTransport,
        *,
        api_key: str | None = None,
        bearer_token: str | None = None,
        api_key_header: str = "ApiKey",
    ):
        if bool(api_key) == bool(bearer_token):
            raise ValueError("select exactly one CE Hub auth mode")
        self.transport = transport
        self._headers = (
            {api_key_header: api_key} if api_key else {"Authorization": f"Bearer {bearer_token}"}
        )

    async def forecast(
        self, location: tuple[float, float], horizon: int, as_of: datetime
    ) -> WeatherBundle:
        lat, lon = validate_request(location, horizon, as_of)
        start, end = utc(as_of), utc(as_of) + timedelta(days=horizon)
        # Wider calendar bounds accommodate local offsets; trim exact UTC horizon on parse.
        payload = await self.transport.request(
            self.name,
            "GET",
            "https://services.cehub.syngenta-ais.com/api/Forecast/ShortRangeForecastHourly",
            headers=self._headers,
            params={
                "latitude": lat,
                "longitude": lon,
                "startDate": (start - timedelta(days=1)).date().isoformat(),
                "endDate": (end + timedelta(days=1)).date().isoformat(),
                "supplier": "Meteoblue",
                "format": "json",
                "measureLabel": ";".join(CE_LABELS),
            },
        )
        try:
            bundle = parse_cehub(
                payload, retrieved_at=datetime.now(UTC), start_at=start, end_at=end
            )
        except (ValueError, TypeError, KeyError):
            raise ProviderUnavailable(self.name, "invalid_forecast_schema") from None
        try:
            daily_payload = await self.transport.request(
                self.name,
                "GET",
                "https://services.cehub.syngenta-ais.com/api/Forecast/ShortRangeForecastDaily",
                headers=self._headers,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "startDate": start.date().isoformat(),
                    "endDate": end.date().isoformat(),
                    "supplier": "Meteoblue",
                    "format": "json",
                    "measureLabel": ";".join(CE_DAILY_LABELS),
                },
            )
            days = parse_cehub_daily(daily_payload)
            return replace(
                bundle,
                daily=days,
                raw_payload_hash=payload_hash({"hourly": payload, "daily": daily_payload}),
                warnings=bundle.warnings
                + ("daily_dates_use_provider_calendar", "provider_et_not_verified_et0"),
            )
        except (ProviderUnavailable, ValueError, TypeError, KeyError):
            return replace(bundle, warnings=bundle.warnings + ("daily_forecast_unavailable",))


OPEN_HOURLY = {
    "temperature_2m": ("temperature_c", "°C"),
    "relative_humidity_2m": ("rh_percent", "%"),
    "wind_speed_10m": ("wind_kmh", "km/h"),
    "wind_gusts_10m": ("gust_kmh", "km/h"),
    "precipitation": ("rain_mm", "mm"),
    "precipitation_probability": ("rain_probability", "%"),
    "shortwave_radiation": ("radiation_wm2", "W/m²"),
}


def parse_openmeteo(payload: Any, retrieved_at: datetime) -> WeatherBundle:
    if payload.get("utc_offset_seconds") != 0:
        raise ValueError("Open-Meteo must respond in UTC")
    hourly, units = payload.get("hourly", {}), payload.get("hourly_units", {})
    times = hourly.get("time", [])
    if not times:
        raise ValueError("no Open-Meteo hourly coverage")
    for key, (_, unit) in OPEN_HOURLY.items():
        if key in hourly and (units.get(key) != unit or len(hourly[key]) != len(times)):
            raise ValueError("unexpected variable unit or array length")
    rows = []
    ending_variables = {
        "wind_gusts_10m",
        "precipitation",
        "precipitation_probability",
        "shortwave_radiation",
    }
    for index, timestamp in enumerate(times):
        values = {}
        for key, (field, _) in OPEN_HOURLY.items():
            source_index = index + 1 if key in ending_variables else index
            covered = source_index < len(times) and (
                source_index == index or times[source_index] - timestamp == 3600
            )
            value = hourly[key][source_index] if key in hourly and covered else None
            values[field] = (
                value / 100 if value is not None and field == "rain_probability" else value
            )
        rows.append(
            Hour(
                datetime.fromtimestamp(timestamp, UTC),
                **values,
                wind_height_m=10,
                source="open-meteo:best_match",
            )
        )
    daily_data, daily_units = payload.get("daily", {}), payload.get("daily_units", {})
    daily_times = daily_data.get("time", [])
    fields = (
        "temperature_2m_min",
        "temperature_2m_max",
        "precipitation_sum",
        "et0_fao_evapotranspiration",
    )
    for key, unit in zip(fields, ("°C", "°C", "mm", "mm")):
        if key in daily_data and (
            daily_units.get(key) != unit or len(daily_data[key]) != len(daily_times)
        ):
            raise ValueError("unexpected daily variable units or length")
    daily = tuple(
        Daily(
            datetime.fromtimestamp(timestamp, UTC).date().isoformat(),
            *(daily_data[key][i] if key in daily_data else None for key in fields),
            source="open-meteo:best_match",
        )
        for i, timestamp in enumerate(daily_times)
    )
    return WeatherBundle(
        "open-meteo:best_match",
        retrieved_at,
        tuple(rows),
        daily,
        grid_latitude=payload.get("latitude"),
        grid_longitude=payload.get("longitude"),
        raw_payload_hash=payload_hash(payload),
        warnings=("et0_is_modeled", "inversion_requires_field_verification"),
        variable_sources=tuple(
            (field, "open-meteo:best_match") for field, _ in OPEN_HOURLY.values()
        ),
    )


def validate_request(
    location: tuple[float, float], horizon: int, as_of: datetime
) -> tuple[float, float]:
    lat, lon = location
    finite(lat, "latitude", -90, 90)
    finite(lon, "longitude", -180, 180)
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 14:
        raise ValueError("forecast horizon must be 1–14 days")
    utc(as_of)
    return lat, lon


class OpenMeteoProvider:
    name = "open-meteo"
    capabilities = frozenset({"forecast_hourly", "forecast_daily"})

    def __init__(self, transport: JsonTransport, *, permitted_free_use: bool = False):
        if not permitted_free_use:
            raise ValueError("explicit permitted-use confirmation required for free endpoint")
        self.transport = transport

    async def forecast(
        self, location: tuple[float, float], horizon: int, as_of: datetime
    ) -> WeatherBundle:
        lat, lon = validate_request(location, horizon, as_of)
        data = await self.transport.request(
            self.name,
            "GET",
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "forecast_days": horizon,
                "hourly": ",".join(OPEN_HOURLY),
                "daily": "temperature_2m_min,temperature_2m_max,precipitation_sum,et0_fao_evapotranspiration",
                "timezone": "UTC",
                "timeformat": "unixtime",
                "wind_speed_unit": "kmh",
                "temperature_unit": "celsius",
                "precipitation_unit": "mm",
            },
        )
        try:
            bundle = parse_openmeteo(data, datetime.now(UTC))
            end = utc(as_of) + timedelta(days=horizon)
            hours = tuple(row for row in bundle.hours if utc(as_of) <= row.start_at < end)
            if not hours:
                raise ValueError("no requested future coverage")
            return replace(bundle, hours=hours)
        except (ValueError, TypeError, KeyError, AttributeError):
            raise ProviderUnavailable(self.name, "invalid_forecast_schema") from None


async def fill_reference_et0(
    bundle: WeatherBundle,
    location: tuple[float, float],
    horizon: int,
    as_of: datetime,
    *,
    providers: tuple[WeatherProvider, ...],
    exclude: WeatherProvider | None = None,
) -> WeatherBundle:
    """Fill missing daily reference ET0 from a provider that publishes it.

    CE Hub's daily series carries no reference ET0 — its
    `Evapotranspiration_DailySum` is deliberately not treated as one, since it is
    not verified to be the FAO-56 reference quantity. Without ET0 the soil water
    balance cannot run at all, so every water figure in the product was blank
    even though temperature, rain, humidity, wind and radiation were all present.

    Deriving ET0 here was the alternative and was rejected: FAO-56 Penman-Monteith
    needs a net-radiation chain and an atmospheric pressure from field elevation,
    and elevation is collected nowhere in the product. A published reference ET0
    is better evidence than a derivation resting on an assumed altitude.

    Rules this follows:
      - Only *missing* values are filled. A primary ET0 is never overwritten.
      - Only matching dates are used, never positional alignment: the two
        providers can return different horizons and different start days.
      - The substitution is recorded in `warnings`, and the affected rows carry
        the donor's name in `source`, so a mixed-provider day is visible rather
        than passing as one coherent observation.
    """
    missing = tuple(row for row in bundle.daily if row.et0_mm is None)
    if not missing:
        return bundle

    # Excluded by identity, not by name: the provider that produced the bundle
    # labels it `cehub:Meteoblue` while its own `name` is `cehub`, so a string
    # comparison let CE Hub re-fetch itself — a duplicate round trip that could
    # not supply the missing value anyway.
    donors = tuple(
        provider
        for provider in providers
        if provider is not exclude and "forecast_daily" in provider.capabilities
    )
    for donor in donors:
        try:
            supplement = await donor.forecast(location, horizon, as_of)
        except ProviderUnavailable:
            continue
        available = {
            row.date: row.et0_mm for row in supplement.daily if row.et0_mm is not None
        }
        if not available:
            continue
        filled = 0
        rows = []
        for row in bundle.daily:
            value = available.get(row.date)
            if row.et0_mm is None and value is not None:
                filled += 1
                rows.append(
                    replace(row, et0_mm=value, source=f"{row.source}+{donor.name}:et0")
                )
            else:
                rows.append(row)
        if filled == 0:
            continue
        return replace(
            bundle,
            daily=tuple(rows),
            warnings=bundle.warnings
            + (f"{donor.name}:reference_et0_substituted_for_{filled}_days",),
        )
    return replace(
        bundle,
        warnings=bundle.warnings + ("reference_et0_unavailable_for_daily_water_balance",),
    )


async def build_weather_bundle(
    location: tuple[float, float],
    horizon: int,
    as_of: datetime,
    *,
    providers: tuple[WeatherProvider, ...],
) -> WeatherBundle:
    validate_request(location, horizon, as_of)
    warnings = []
    for provider in providers:
        if "forecast_hourly" not in provider.capabilities:
            warnings.append(f"{provider.name}:forecast_not_supported")
            continue
        try:
            bundle = await provider.forecast(location, horizon, as_of)
            bundle = replace(bundle, warnings=bundle.warnings + tuple(warnings))
            # The primary provider wins on every quantity it supplies. Reference
            # ET0 is the one gap worth filling from elsewhere, because nothing in
            # the water balance works without it.
            return await fill_reference_et0(
                bundle, location, horizon, as_of, providers=providers, exclude=provider
            )
        except ProviderUnavailable as exc:
            warnings.append(f"{exc.provider}:{exc.code}")
    return WeatherBundle(
        "none",
        datetime.now(UTC),
        mode="unavailable",
        warnings=tuple(warnings) + ("no_forecast_provider_available",),
    )
