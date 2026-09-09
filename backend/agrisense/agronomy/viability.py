"""Layer 3: decide which specific hours a sprayed droplet will survive.

A correct date is not an instruction a farmer can act on. This layer filters the
candidate days down to the hours where the droplet reaches the leaf and stays there
long enough to be absorbed. The reason an hour was rejected is a first class output.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import date as Date
from datetime import datetime
from typing import Any

from .constants import (
    DELTA_T_IDEAL,
    DELTA_T_REJECT_ABOVE,
    RAIN_FREE_HOURS_REQUIRED,
    WIND_IDEAL,
    WIND_REJECT_ABOVE,
    WIND_REJECT_BELOW,
)
from .types import HourlyWeather


def wet_bulb_stull(temperature_c: float, humidity_pct: float) -> float:
    """Wet bulb temperature using the Stull approximation.

    Valid for relative humidity between 5 and 99 percent and temperatures between
    -20 and 50 degrees Celsius, which covers every Indian field condition we target.
    """
    rh = min(max(humidity_pct, 1.0), 100.0)
    t = temperature_c
    return (
        t * math.atan(0.151977 * math.sqrt(rh + 8.313659))
        + math.atan(t + rh)
        - math.atan(rh - 1.676331)
        + 0.00391838 * rh**1.5 * math.atan(0.023101 * rh)
        - 4.686035
    )


def delta_t(temperature_c: float, humidity_pct: float) -> float:
    """Delta T, the gap between dry bulb and wet bulb temperature.

    This is the single best predictor of whether a fine droplet evaporates before it
    reaches the leaf surface.
    """
    return temperature_c - wet_bulb_stull(temperature_c, humidity_pct)


@dataclass(frozen=True)
class HourScore:
    timestamp: datetime
    viable: bool
    score: float
    delta_t: float
    wind_kmh: float
    temperature_c: float
    humidity_pct: float
    rain_free_hours: int
    rejection_rule: str | None = None
    rejection_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "viable": self.viable,
            "score": self.score,
            "delta_t": self.delta_t,
            "wind_kmh": self.wind_kmh,
            "temperature_c": self.temperature_c,
            "humidity_pct": self.humidity_pct,
            "rain_free_hours": self.rain_free_hours,
            "rejection_rule": self.rejection_rule,
            "rejection_reason": self.rejection_reason,
        }


@dataclass(frozen=True)
class SprayWindow:
    """A run of consecutive viable hours on one day."""

    start: datetime
    end: datetime
    score: float
    hours: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "score": self.score,
            "hours": self.hours,
        }


@dataclass(frozen=True)
class RankedHours:
    hours: list[HourScore]
    windows: list[SprayWindow]

    @property
    def best_window(self) -> SprayWindow | None:
        return max(self.windows, key=lambda w: (w.score, w.hours)) if self.windows else None

    @property
    def viability(self) -> float:
        best = self.best_window
        return best.score if best else 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "hours": [h.as_dict() for h in self.hours],
            "windows": [w.as_dict() for w in self.windows],
            "best_window": self.best_window.as_dict() if self.best_window else None,
        }


def _rain_free_hours(index: int, hourly: list[HourlyWeather], horizon: int = 12) -> int:
    """Count consecutive rain free hours starting at index."""
    count = 0
    for offset in range(1, horizon + 1):
        pos = index + offset
        if pos >= len(hourly):
            break
        if hourly[pos].precipitation_mm > 0.1:
            break
        count += 1
    return count


def _proximity(value: float, low: float, high: float) -> float:
    """1.0 at the centre of a band, falling to 0.0 at its edges and beyond."""
    centre = (low + high) / 2.0
    half = max((high - low) / 2.0, 1e-09)
    return max(0.0, 1.0 - abs(value - centre) / half)


def _delta_t_component(value: float) -> float:
    """Score Delta T on a plateau rather than on distance from the band centre.

    Delta T is not symmetric in its effect. The low end of the 2 to 8 band is where
    droplet survival is best, so scoring by distance from the centre would rank a
    hot afternoon at Delta T 8 equal to a humid dawn at Delta T 2, and in practice
    rank a mid afternoon window above a dawn one. That is the wrong answer for a
    heat stressed field.

    The shape used instead is a plateau across 2 to 5, falling away to zero at the
    hard rejection point of 10 above and at 0 below, since a Delta T near zero means
    the droplet never dries and can run off the leaf before it is taken up.
    """
    plateau_low, plateau_high = DELTA_T_IDEAL.low, 5.0
    if plateau_low <= value <= plateau_high:
        return 1.0
    if value < plateau_low:
        return max(0.0, value / plateau_low)
    return max(0.0, (DELTA_T_REJECT_ABOVE - value) / (DELTA_T_REJECT_ABOVE - plateau_high))


def score_hour(index: int, hourly: list[HourlyWeather]) -> HourScore:
    hour = hourly[index]
    dt = round(delta_t(hour.temperature_c, hour.humidity_pct), 2)
    rain_free = _rain_free_hours(index, hourly)

    base = {
        "timestamp": hour.timestamp,
        "delta_t": dt,
        "wind_kmh": round(hour.wind_kmh, 2),
        "temperature_c": hour.temperature_c,
        "humidity_pct": hour.humidity_pct,
        "rain_free_hours": rain_free,
    }

    if hour.precipitation_mm > 0.1:
        return HourScore(
            **base,
            viable=False,
            score=0.0,
            rejection_rule="raining_now",
            rejection_reason="It is raining in this hour.",
        )

    if dt > DELTA_T_REJECT_ABOVE:
        return HourScore(
            **base,
            viable=False,
            score=0.0,
            rejection_rule="delta_t_high",
            rejection_reason=f"Delta T {dt}, too dry. The spray will evaporate before it reaches the leaf.",
        )

    if hour.wind_kmh > WIND_REJECT_ABOVE:
        return HourScore(
            **base,
            viable=False,
            score=0.0,
            rejection_rule="wind_high",
            rejection_reason=f"Wind {hour.wind_kmh:.0f} km/h, too strong. The spray will drift off the field.",
        )

    if hour.wind_kmh < WIND_REJECT_BELOW:
        return HourScore(
            **base,
            viable=False,
            score=0.0,
            rejection_rule="wind_low",
            rejection_reason=f"Wind {hour.wind_kmh:.0f} km/h, too still. Spray can hang in the air and settle where it is not wanted.",
        )

    if rain_free < RAIN_FREE_HOURS_REQUIRED:
        return HourScore(
            **base,
            viable=False,
            score=0.0,
            rejection_rule="rain_soon",
            rejection_reason=f"Rain expected within {rain_free + 1} {'hour' if rain_free + 1 == 1 else 'hours'}. The product needs {RAIN_FREE_HOURS_REQUIRED} dry hours to be absorbed.",
        )

    delta_component = _delta_t_component(dt)
    wind_component = _proximity(hour.wind_kmh, WIND_IDEAL.low, WIND_IDEAL.high)
    margin_component = min((rain_free - RAIN_FREE_HOURS_REQUIRED) / RAIN_FREE_HOURS_REQUIRED, 1.0)
    solar_component = max(0.0, 1.0 - hour.solar_wh_m2 / 900.0)
    uptake_component = _uptake_component(hour.timestamp.hour)

    score = (
        0.4 * delta_component
        + 0.2 * wind_component
        + 0.12 * margin_component
        + 0.1 * solar_component
        + 0.18 * uptake_component
    )

    return HourScore(**base, viable=True, score=round(min(max(score, 0.0), 1.0), 4))


def _best_slice(run: list[HourScore], max_hours: int) -> list[HourScore]:
    """The highest scoring contiguous slice of a viable run.

    Ties are broken toward the earlier slice, because cooler earlier hours are the
    safer recommendation when two stretches score the same.
    """
    if len(run) <= max_hours:
        return run

    best_start, best_mean = 0, -1.0
    for start in range(len(run) - max_hours + 1):
        window = run[start : start + max_hours]
        mean = sum(h.score for h in window) / max_hours
        if mean > best_mean + 1e-09:
            best_start, best_mean = start, mean

    return run[best_start : best_start + max_hours]


MAX_WINDOW_HOURS: int = 3


def _uptake_component(hour_of_day: int) -> float:
    if 5 <= hour_of_day <= 10:
        return 1.0
    if 16 <= hour_of_day <= 19:
        return 0.65
    if 11 <= hour_of_day <= 15:
        return 0.45
    return 0.25


def _build_windows(hours: list[HourScore], min_hours: int = 2) -> list[SprayWindow]:
    """Collapse consecutive viable hours into actionable windows."""
    windows: list[SprayWindow] = []
    run: list[HourScore] = []

    def flush() -> None:
        if len(run) >= min_hours:
            slice_ = _best_slice(run, MAX_WINDOW_HOURS)
            windows.append(
                SprayWindow(
                    start=slice_[0].timestamp,
                    end=slice_[-1].timestamp,
                    score=round(sum(h.score for h in slice_) / len(slice_), 4),
                    hours=len(slice_),
                )
            )

    for hour in hours:
        if hour.viable:
            if run and (hour.timestamp - run[-1].timestamp).total_seconds() > 3700:
                flush()
                run = []
            run.append(hour)
        else:
            flush()
            run = []

    flush()
    return windows


def spray_viability(hourly: list[HourlyWeather], candidate_days: list[Date] | None = None) -> RankedHours:
    """Score every hour and collapse the viable ones into windows.

    Every hour is returned, including rejected ones, because the interface shows
    the farmer exactly why an hour was ruled out.
    """
    scored = [score_hour(i, hourly) for i in range(len(hourly))]

    if candidate_days is not None:
        allowed = set(candidate_days)
        scored = [h for h in scored if h.timestamp.date() in allowed]

    # Legacy HourlyWeather cannot carry verified label, gust, measurement-height,
    # inversion or equipment inputs. Keep diagnostics but do not certify a window.
    # The v1 science window engine enforces these on complete candidate intervals.
    scored = [replace(hour, viable=False, score=0.0,
                      rejection_rule="reviewed_safety_inputs_required",
                      rejection_reason="Use the science facade with reviewed product and field safety inputs.")
              for hour in scored]
    return RankedHours(scored, [])
