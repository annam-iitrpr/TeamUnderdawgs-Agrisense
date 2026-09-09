"""Internal normalized weather values, awaiting the platform's generated contracts."""

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from itertools import pairwise

from .units import finite


def utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("naive timestamp is forbidden")
    return value.astimezone(UTC)


@dataclass(frozen=True)
class Hour:
    start_at: datetime
    temperature_c: float | None = None
    rh_percent: float | None = None
    wind_kmh: float | None = None
    gust_kmh: float | None = None
    rain_mm: float | None = None
    rain_probability: float | None = None
    radiation_wm2: float | None = None
    wind_height_m: float | None = None
    inversion_clear: bool | None = None
    source: str = "unknown"
    interval_hours: int = 1

    def __post_init__(self) -> None:
        object.__setattr__(self, "start_at", utc(self.start_at))
        if self.interval_hours != 1:
            raise ValueError("only actual hourly records belong in Hour")
        for name, lo, hi in (
            ("temperature_c", -90, 65),
            ("rh_percent", 0, 100),
            ("wind_kmh", 0, 300),
            ("gust_kmh", 0, 400),
            ("rain_mm", 0, 1000),
            ("rain_probability", 0, 1),
            ("radiation_wm2", 0, 1600),
            ("wind_height_m", 0.1, 100),
        ):
            value = getattr(self, name)
            if value is not None:
                finite(value, name, lo, hi)
        if (
            self.gust_kmh is not None
            and self.wind_kmh is not None
            and self.gust_kmh < self.wind_kmh
        ):
            raise ValueError("gust below sustained wind")

    @property
    def missing(self) -> tuple[str, ...]:
        return tuple(
            key
            for key in ("temperature_c", "rh_percent", "wind_kmh", "rain_mm")
            if getattr(self, key) is None
        )


@dataclass(frozen=True)
class Daily:
    date: str
    tmin_c: float | None
    tmax_c: float | None
    rain_mm: float | None
    et0_mm: float | None
    source: str

    def __post_init__(self) -> None:
        from datetime import date

        date.fromisoformat(self.date)
        for value in (self.tmin_c, self.tmax_c):
            if value is not None:
                finite(value, "temperature", -90, 65)
        for value in (self.rain_mm, self.et0_mm):
            if value is not None:
                finite(value, "water depth", 0)
        if self.tmin_c is not None and self.tmax_c is not None and self.tmin_c > self.tmax_c:
            raise ValueError("daily minimum exceeds maximum")


@dataclass(frozen=True)
class WeatherBundle:
    provider: str
    retrieved_at: datetime
    hours: tuple[Hour, ...] = ()
    daily: tuple[Daily, ...] = ()
    issued_at: datetime | None = None
    grid_latitude: float | None = None
    grid_longitude: float | None = None
    resolution_m: float | None = None
    raw_payload_hash: str | None = None
    mode: str = "live"
    warnings: tuple[str, ...] = ()
    variable_sources: tuple[tuple[str, str], ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        object.__setattr__(self, "retrieved_at", utc(self.retrieved_at))
        if self.issued_at is not None:
            object.__setattr__(self, "issued_at", utc(self.issued_at))
            if self.issued_at > self.retrieved_at:
                raise ValueError("issue time after retrieval")
        elif "issue_time_unknown" not in self.warnings:
            object.__setattr__(self, "warnings", self.warnings + ("issue_time_unknown",))
        if self.mode not in ("live", "estimated", "demo", "mixed", "unavailable"):
            raise ValueError("unknown data mode")
        hours = tuple(sorted(self.hours, key=lambda row: row.start_at))
        if len({row.start_at for row in hours}) != len(hours):
            raise ValueError("duplicate hourly timestamp")
        if any(b.start_at - a.start_at < timedelta(hours=1) for a, b in pairwise(hours)):
            raise ValueError("overlapping hourly intervals")
        if len({row.date for row in self.daily}) != len(self.daily):
            raise ValueError("duplicate daily date")
        object.__setattr__(self, "hours", hours)
        object.__setattr__(self, "daily", tuple(sorted(self.daily, key=lambda row: row.date)))
        for value, name, lo, hi in (
            (self.grid_latitude, "latitude", -90, 90),
            (self.grid_longitude, "longitude", -180, 180),
        ):
            if value is not None:
                finite(value, name, lo, hi)

    @property
    def coverage_end(self) -> datetime | None:
        return None if not self.hours else self.hours[-1].start_at + timedelta(hours=1)


def cache_key(
    *,
    provider: str,
    latitude: float,
    longitude: float,
    variables: tuple[str, ...],
    horizon: int,
    issued_at: datetime | None,
    model: str,
    as_of: datetime,
) -> str:
    # Exact coordinates until each provider's actual grid mapping is known.
    payload = [
        provider,
        latitude,
        longitude,
        sorted(set(variables)),
        horizon,
        model,
        None if issued_at is None else utc(issued_at).isoformat(),
        utc(as_of).date().isoformat(),
    ]
    return sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()


def freshness(
    bundle: WeatherBundle, as_of: datetime, *, ttl_minutes: int = 45, stale_limit_minutes: int = 180
) -> str:
    if not 0 < ttl_minutes <= stale_limit_minutes:
        raise ValueError("invalid freshness policy")
    age = (utc(as_of) - bundle.retrieved_at).total_seconds() / 60
    if age < 0:
        raise ValueError("retrieval is in the future")
    if bundle.coverage_end is not None and bundle.coverage_end <= utc(as_of):
        return "expired"
    return "fresh" if age <= ttl_minutes else "stale" if age <= stale_limit_minutes else "expired"
