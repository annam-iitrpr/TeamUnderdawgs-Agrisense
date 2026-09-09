"""Repeatable CPU-only benchmark with explicit synthetic 336-hour conditions."""

import json
import platform
from datetime import UTC, datetime, timedelta
from statistics import median
from time import perf_counter

import numpy as np
from agrisense.science.weather import Hour, WeatherBundle
from agrisense.science.windows import Candidate, SprayPolicy, rank_windows


def main() -> None:
    start = datetime(2026, 9, 10, tzinfo=UTC)
    weather = WeatherBundle(
        "synthetic-benchmark",
        start,
        tuple(
            Hour(
                start + timedelta(hours=i),
                25,
                60,
                8,
                12,
                0,
                0.1,
                200,
                10,
                True,
                "synthetic",
            )
            for i in range(336)
        ),
        mode="demo",
    )
    policy = SprayPolicy(
        "synthetic-not-field-evidence", True, 3, 15, 20, 10, 2, 8, 10, 35, 0, 0.2, 4
    )
    candidates = tuple(
        Candidate(row.start_at, row.start_at + timedelta(hours=2), 0.8, 0.9)
        for row in weather.hours
    )
    timings = []
    for _ in range(50):
        before = perf_counter()
        result = rank_windows(
            weather, candidates, policy, as_of=start, area_ha=1, capacity_ha_hour=1
        )
        timings.append((perf_counter() - before) * 1000)
        assert result["readiness"] == 72
    print(
        json.dumps(
            {
                "fixture": "synthetic_336_hours_336_candidates",
                "runs": len(timings),
                "python": platform.python_version(),
                "architecture": platform.machine(),
                "median_ms": median(timings),
                "p95_ms": float(np.quantile(timings, 0.95)),
                "network_included": False,
                "field_accuracy_claim": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
