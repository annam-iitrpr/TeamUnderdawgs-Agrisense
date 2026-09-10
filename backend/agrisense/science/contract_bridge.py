"""Conversions at the single generated-contract boundary; no forked public schema."""

from datetime import timedelta

from agrisense.contracts_generated import models as api

from .stress import vpd_kpa
from .weather import Daily, Hour, WeatherBundle


def measurement(
    value: float | None,
    unit: str,
    reason: str = "input_missing",
    provenance: list[api.Provenance] | None = None,
) -> api.Measurement:
    return api.Measurement(
        value=value,
        unit=unit,
        missing_reason=reason if value is None else None,
        provenance=provenance or [],
    )


def estimate(
    value: float | None,
    unit: str,
    target: str,
    reason: str = "evidence_required",
    assumptions: list[str] | None = None,
    evidence_ids: list[str] | None = None,
    basis: str = "scenario",
) -> api.Estimate:
    return api.Estimate(
        p10=value,
        p50=value,
        p90=value,
        unit=unit,
        basis=basis,
        target=target,
        missing_reason=reason if value is None else None,
        input_completeness=0 if value is None else 1,
        assumptions=assumptions or [],
        evidence_ids=evidence_ids or [],
    )


def from_contract(forecast: api.ForecastBundle) -> WeatherBundle:
    hours = []
    for row in forecast.hourly:
        if row.interval.end_at - row.interval.start_at != timedelta(hours=1):
            raise ValueError("spray ranking requires actual one-hour records")
        fields = [
            (row.temperature_c, "°C"),
            (row.relative_humidity_pct, "%"),
            (row.wind_kmh, "km/h"),
            (row.rain_mm, "mm"),
        ]
        for value, unit in fields:
            if value.unit != unit:
                raise ValueError("forecast contract unit mismatch")
        radiation = row.radiation_w_m2
        if radiation is not None and radiation.unit != "W/m²":
            raise ValueError("radiation must be W/m²")
        gust = row.gust_kmh
        if gust is not None and gust.value is not None and gust.unit != "km/h":
            raise ValueError("gust must be km/h")
        probability = row.rain_probability
        if probability is not None and probability.value is not None and probability.unit != "ratio":
            raise ValueError("rain probability must be a ratio from 0 to 1")
        hours.append(
            Hour(
                row.interval.start_at,
                row.temperature_c.value,
                row.relative_humidity_pct.value,
                row.wind_kmh.value,
                # Read back rather than left null. The ranker treats an unknown
                # gust as a refusal, so dropping it here was indistinguishable
                # from a provider that had never reported one.
                gust_kmh=None if gust is None else gust.value,
                rain_mm=row.rain_mm.value,
                rain_probability=None if probability is None else probability.value,
                radiation_wm2=None if radiation is None else radiation.value,
                wind_height_m=row.wind_height_m,
                inversion_clear=row.inversion_clear,
                source=forecast.provider,
                radiation_missing_reason=None if radiation is None else radiation.missing_reason,
            )
        )
    days = []
    for row in forecast.daily:
        for value, unit in (
            (row.minimum_temperature_c, "°C"),
            (row.maximum_temperature_c, "°C"),
            (row.rain_mm, "mm"),
            (row.et0_mm, "mm"),
        ):
            if value.unit != unit:
                raise ValueError("daily contract unit mismatch")
        days.append(
            Daily(
                row.local_date.isoformat(),
                row.minimum_temperature_c.value,
                row.maximum_temperature_c.value,
                row.rain_mm.value,
                row.et0_mm.value,
                forecast.provider,
            )
        )
    return WeatherBundle(
        forecast.provider,
        forecast.retrieved_at,
        tuple(hours),
        tuple(days),
        forecast.issued_at,
        forecast.grid_location.latitude,
        forecast.grid_location.longitude,
        None if forecast.grid_resolution_km is None else forecast.grid_resolution_km * 1000,
        forecast.raw_payload_hash,
        forecast.data_mode,
        tuple(forecast.warnings),
    )


def to_contract(bundle: WeatherBundle, location: api.Location) -> api.ForecastBundle:
    if not bundle.hours:
        # v1 mandates a nonempty coverage interval. Never fabricate one for unavailable.
        from .providers import ProviderUnavailable

        raise ProviderUnavailable(
            bundle.provider, "empty_coverage_contract_requires_additive_fix", bundle.warnings
        )
    provenance = [
        api.Provenance(
            source=bundle.provider,
            retrieved_at=bundle.retrieved_at,
            data_mode=bundle.mode,
            note="; ".join(bundle.warnings),
        )
    ]
    hours = []
    for row in bundle.hours:
        vpd = (
            None
            if row.temperature_c is None or row.rh_percent is None
            else vpd_kpa(row.temperature_c, row.rh_percent)
        )
        hours.append(
            api.ForecastHour(
                interval=api.Interval(
                    start_at=row.start_at, end_at=row.start_at + timedelta(hours=1)
                ),
                temperature_c=measurement(row.temperature_c, "°C", provenance=provenance),
                relative_humidity_pct=measurement(row.rh_percent, "%", provenance=provenance),
                wind_kmh=measurement(row.wind_kmh, "km/h", provenance=provenance),
                wind_height_m=row.wind_height_m,
                rain_mm=measurement(row.rain_mm, "mm", provenance=provenance),
                vpd_kpa=measurement(vpd, "kPa", provenance=provenance),
                radiation_w_m2=measurement(
                    row.radiation_wm2,
                    "W/m²",
                    row.radiation_missing_reason or "input_missing",
                    provenance=provenance,
                ),
                # Carried now rather than dropped. The spray ranker refuses an
                # hour whose gust it does not know, so losing these three here
                # meant no window could be named on the far side of this
                # boundary no matter what the provider had supplied.
                gust_kmh=measurement(row.gust_kmh, "km/h", provenance=provenance),
                # A fraction, not a percentage: the internal bound is 0 to 1 and the
                # spray policy compares against 0.3. Labelling it "%" here would
                # invite a reader to multiply it by a hundred twice.
                rain_probability=measurement(row.rain_probability, "ratio", provenance=provenance),
                inversion_clear=row.inversion_clear,
            )
        )
    days = [
        api.ForecastDay(
            local_date=row.date,
            minimum_temperature_c=measurement(row.tmin_c, "°C", provenance=provenance),
            maximum_temperature_c=measurement(row.tmax_c, "°C", provenance=provenance),
            rain_mm=measurement(row.rain_mm, "mm", provenance=provenance),
            et0_mm=measurement(row.et0_mm, "mm", provenance=provenance),
        )
        for row in bundle.daily
    ]
    return api.ForecastBundle(
        provider=bundle.provider,
        grid_location=location,
        grid_resolution_km=None if bundle.resolution_m is None else bundle.resolution_m / 1000,
        retrieved_at=bundle.retrieved_at,
        issued_at=bundle.issued_at,
        coverage=api.Interval(start_at=bundle.hours[0].start_at, end_at=bundle.coverage_end),
        hourly=hours,
        daily=days,
        raw_payload_hash=bundle.raw_payload_hash or "unavailable",
        data_mode=bundle.mode,
        provenance=provenance,
        warnings=list(bundle.warnings)
        + ["grid_location_is_request_location_when_grid_unknown"],
    )
