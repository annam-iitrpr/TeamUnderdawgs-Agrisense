"""Hard-gated hourly spray windows; soft scoring cannot reopen rejected hours."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from math import atan, ceil, floor, sqrt

from .units import finite
from .weather import Hour, WeatherBundle, freshness, utc


def wet_bulb_stull(temperature_c: float, rh_percent: float) -> float:
    """Stull (2011), standard sea-level pressure approximation.

    Conservative domain excludes the cold/dry corner; altitude/pressure is not
    corrected. DOI:10.1175/JAMC-D-11-0143.1. Not a pressure-aware solver.
    """
    finite(temperature_c, "Stull temperature", -20, 50)
    finite(rh_percent, "Stull RH", 5, 99)
    if temperature_c < 0 and rh_percent < 20:
        raise ValueError("cold/dry conditions outside conservative Stull domain")
    t, rh = temperature_c, rh_percent
    return (
        t * atan(0.151977 * sqrt(rh + 8.313659))
        + atan(t + rh)
        - atan(rh - 1.676331)
        + 0.00391838 * rh**1.5 * atan(0.023101 * rh)
        - 4.686035
    )


@dataclass(frozen=True)
class SprayPolicy:
    evidence_id: str
    reviewed: bool
    wind_min_kmh: float
    wind_max_kmh: float
    gust_max_kmh: float
    wind_height_m: float
    delta_t_min_c: float
    delta_t_max_c: float
    temperature_min_c: float
    temperature_max_c: float
    rain_max_mm: float
    rain_probability_max: float
    rainfast_hours: float
    require_gust: bool = True
    require_rain_probability: bool = True

    def __post_init__(self) -> None:
        if not self.evidence_id:
            raise ValueError("policy evidence/version is required")
        for lo, hi in (
            (self.wind_min_kmh, self.wind_max_kmh),
            (self.delta_t_min_c, self.delta_t_max_c),
            (self.temperature_min_c, self.temperature_max_c),
        ):
            finite(lo, "lower limit")
            finite(hi, "upper limit")
            if lo > hi:
                raise ValueError("invalid spray policy interval")
        finite(self.rainfast_hours, "rainfast", 0, 48)
        finite(self.rain_max_mm, "rain limit", 0)
        finite(self.rain_probability_max, "rain probability", 0, 1)
        finite(self.gust_max_kmh, "gust limit", 0, 400)
        finite(self.wind_height_m, "height", 0.1, 100)


@dataclass(frozen=True)
class Candidate:
    start_at: datetime
    end_at: datetime
    need: float | None
    timing_fit: float | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "start_at", utc(self.start_at))
        object.__setattr__(self, "end_at", utc(self.end_at))
        if self.end_at <= self.start_at or self.end_at - self.start_at > timedelta(hours=24):
            raise ValueError("invalid spray interval")
        for value in (self.need, self.timing_fit):
            if value is not None:
                finite(value, "readiness component", 0, 1)


def hour_reasons(hour: Hour, policy: SprayPolicy, *, spraying: bool) -> list[str]:
    reasons = []
    if hour.rain_mm is None:
        reasons.append("rain_missing")
    elif hour.rain_mm > policy.rain_max_mm:
        reasons.append("rain_exceeds_limit")
    if hour.rain_probability is None:
        if policy.require_rain_probability:
            reasons.append("rain_probability_missing")
    elif hour.rain_probability > policy.rain_probability_max:
        reasons.append("rain_probability_exceeds_limit")
    if not spraying:
        return reasons
    if hour.inversion_clear is not True:
        reasons.append(
            "inversion_detected"
            if hour.inversion_clear is False
            else "inversion_field_verification_required"
        )
    if hour.wind_height_m != policy.wind_height_m:
        reasons.append("wind_height_mismatch_or_missing")
    if hour.wind_kmh is None:
        reasons.append("wind_missing")
    elif not policy.wind_min_kmh <= hour.wind_kmh <= policy.wind_max_kmh:
        reasons.append("wind_outside_limits")
    if hour.gust_kmh is None:
        if policy.require_gust:
            reasons.append("gust_missing")
    elif hour.gust_kmh > policy.gust_max_kmh:
        reasons.append("gust_exceeds_limit")
    if hour.temperature_c is None or hour.rh_percent is None:
        reasons.append("temperature_or_humidity_missing")
    else:
        if not policy.temperature_min_c <= hour.temperature_c <= policy.temperature_max_c:
            reasons.append("temperature_outside_limits")
        try:
            delta = hour.temperature_c - wet_bulb_stull(hour.temperature_c, hour.rh_percent)
            if not policy.delta_t_min_c <= delta <= policy.delta_t_max_c:
                reasons.append("delta_t_outside_limits")
        except ValueError:
            reasons.append("wet_bulb_outside_domain")
    return reasons


def rank_windows(
    bundle: WeatherBundle,
    candidates: tuple[Candidate, ...],
    policy: SprayPolicy,
    *,
    as_of: datetime,
    area_ha: float,
    capacity_ha_hour: float,
) -> dict:
    finite(area_ha, "area", 0.000001)
    finite(capacity_ha_hour, "equipment capacity", 0.000001)
    now = utc(as_of)
    if not policy.reviewed:
        return {
            "status": "insufficient_data",
            "selected_window": None,
            "readiness": None,
            "reasons": ["spray_policy_requires_review"],
            "alternatives": [],
            "rejected": [],
        }
    if freshness(bundle, now) != "fresh":
        return {
            "status": "insufficient_data",
            "selected_window": None,
            "readiness": None,
            "reasons": ["fresh_forecast_required"],
            "alternatives": [],
            "rejected": [],
        }
    # An unconfirmed interval convention is carried, not fatal.
    #
    # It means we have not confirmed whether the provider timestamps an hour at
    # its start or its end, which can shift a named window by an hour. The
    # configured provider emits this warning on every response, so treating it
    # as a blocker meant no spray window could ever be named for any farmer on
    # any field -- the whole feature was unreachable by construction, and the
    # farmer was told the data was missing when it was actually present.
    #
    # A possible one hour offset, stated, is a smaller harm than refusing to
    # answer at all, so it travels with the recommendation as a reason the
    # farmer and an agronomist can both see.
    carried = (
        ["window_edges_may_shift_one_hour_provider_interval_unconfirmed"]
        if "interval_semantics_unconfirmed" in bundle.warnings
        else []
    )
    hours = {hour.start_at: hour for hour in bundle.hours}
    accepted, rejected = [], []
    unique = {(row.start_at, row.end_at): row for row in candidates}
    if len(unique) != len(candidates):
        raise ValueError("duplicate candidate interval")
    for candidate in sorted(candidates, key=lambda c: (c.start_at, c.end_at)):
        reasons, hourly_rejections = [], []
        if candidate.start_at < now:
            reasons.append("application_in_past")
        if (
            candidate.end_at - candidate.start_at
        ).total_seconds() / 3600 < area_ha / capacity_ha_hour:
            reasons.append("insufficient_equipment_time")
        if candidate.need is None or candidate.timing_fit is None:
            reasons.append("readiness_component_missing")
        elif candidate.timing_fit == 0 and candidate.need > 0:
            reasons.append("outside_supported_timing")
        # Cover every intersecting hour through rainfast after the FINAL portion.
        origin = bundle.hours[0].start_at if bundle.hours else candidate.start_at
        cursor = origin + timedelta(
            hours=floor((candidate.start_at - origin).total_seconds() / 3600)
        )
        lookahead_end = candidate.end_at + timedelta(hours=policy.rainfast_hours)
        while cursor < lookahead_end:
            hour = hours.get(cursor)
            failures = (
                ["hourly_coverage_missing"]
                if hour is None
                else hour_reasons(hour, policy, spraying=cursor < candidate.end_at)
            )
            if failures:
                hourly_rejections.append({"start_at": cursor.isoformat(), "reasons": failures})
                reasons.extend(failures)
            cursor += timedelta(hours=1)
        record = {
            "start_at": candidate.start_at.isoformat(),
            "end_at": candidate.end_at.isoformat(),
            "need": candidate.need,
            "timing_fit": candidate.timing_fit,
        }
        if reasons:
            rejected.append(
                {**record, "reasons": sorted(set(reasons)), "hourly": hourly_rejections}
            )
        else:
            # Binary feasibility viability, explicitly not a modeled efficacy probability.
            readiness = round(100 * candidate.need * candidate.timing_fit)
            accepted.append(
                {
                    **record,
                    "viability": 1.0,
                    "readiness": readiness,
                    "rainfast_end_at": lookahead_end.isoformat(),
                }
            )
    accepted.sort(key=lambda row: (-row["readiness"], row["start_at"], row["end_at"]))
    selected = accepted[0] if accepted else None
    missing = any(
        any(
            "missing" in reason or "verification" in reason or "domain" in reason
            for reason in row["reasons"]
        )
        for row in rejected
    )
    status = (
        "monitor"
        if selected and selected["need"] == 0
        else "recommended"
        if selected
        else "insufficient_data"
        if missing or not candidates
        else "blocked"
    )
    # A zero need is a monitoring state, never an instruction to apply.
    #
    # Being blocked is a finding, not a gap. The stress was worked out, the hours
    # were checked and none of them are safe to spray in, which is a readiness of
    # zero with the reasons attached -- "not this week, and here is why". Only a
    # genuine gap keeps a null score: where a reading was missing we did not
    # assess the hour, and a zero would claim we had.
    return {
        "status": status,
        "selected_window": selected if status == "recommended" else None,
        "readiness": (
            selected["readiness"]
            if selected
            else None
            if status == "insufficient_data"
            else 0
        ),
        "alternatives": accepted[1:4] if status == "recommended" else [],
        "rejected": rejected,
        "reasons": carried
        + (
            ["no_stress_need"]
            if status == "monitor"
            else []
            if selected
            else ["no_eligible_window"]
        ),
        "policy_evidence_id": policy.evidence_id,
        "assumptions": ["binary_feasibility_viability", "stull_standard_pressure_approximation"],
    }


def duration_hours(area_ha: float, capacity_ha_hour: float, minimum: int = 2) -> int:
    finite(area_ha, "area", 0.000001)
    finite(capacity_ha_hour, "capacity", 0.000001)
    return max(minimum, ceil(area_ha / capacity_ha_hour))
