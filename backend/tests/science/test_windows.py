import unittest
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone

from agrisense.science.weather import Hour, WeatherBundle, freshness
from agrisense.science.windows import Candidate, SprayPolicy, rank_windows, wet_bulb_stull

NOW = datetime(2026, 9, 10, 0, tzinfo=UTC)
POLICY = SprayPolicy("synthetic-test-policy", True, 3, 15, 20, 10, 2, 8, 10, 35, 0, 0.2, 4)


def fixture(count=12):
    return WeatherBundle(
        "synthetic-test",
        NOW,
        tuple(
            Hour(NOW + timedelta(hours=i), 25, 60, 8, 12, 0, 0.1, 200, 10, True, "synthetic-test")
            for i in range(count)
        ),
        mode="demo",
    )


def evaluate(bundle=None, candidates=None, **kwargs):
    return rank_windows(
        bundle or fixture(),
        candidates or (Candidate(NOW, NOW + timedelta(hours=2), 0.8, 0.9),),
        POLICY,
        as_of=NOW,
        area_ha=1,
        capacity_ha_hour=1,
        **kwargs,
    )


class WindowTests(unittest.TestCase):
    def test_reproducible_components_and_order(self):
        early = Candidate(NOW, NOW + timedelta(hours=2), 0.8, 0.9)
        late = Candidate(NOW + timedelta(hours=3), NOW + timedelta(hours=5), 1, 0.5)
        forward = evaluate(candidates=(early, late))
        backward = evaluate(candidates=(late, early))
        self.assertEqual(forward, backward)
        self.assertEqual(forward["readiness"], 72)
        self.assertEqual(forward["selected_window"]["need"], 0.8)

    def test_rainfast_after_last_portion(self):
        bundle = fixture(6)
        self.assertEqual(evaluate(bundle)["status"], "recommended")
        self.assertEqual(evaluate(fixture(5))["status"], "insufficient_data")
        # Rain 5 hours after the start, beyond start+4 but inside end+4, must block.
        hours = list(bundle.hours)
        hours[5] = replace(hours[5], rain_mm=1)
        self.assertEqual(evaluate(replace(bundle, hours=tuple(hours)))["status"], "blocked")

    def test_missing_is_not_safe_zero(self):
        for field in (
            "rain_mm",
            "rh_percent",
            "wind_kmh",
            "temperature_c",
            "inversion_clear",
            "gust_kmh",
        ):
            bundle = fixture()
            changed = replace(bundle.hours[0], **{field: None})
            result = evaluate(replace(bundle, hours=(changed,) + bundle.hours[1:]))
            self.assertIsNone(result["selected_window"], field)
            self.assertEqual(result["status"], "insufficient_data", field)

    def test_worst_hour_and_gap(self):
        for field, value in (("gust_kmh", 25), ("wind_kmh", 2), ("inversion_clear", False)):
            bundle = fixture()
            changed = replace(bundle.hours[1], **{field: value})
            result = evaluate(replace(bundle, hours=(bundle.hours[0], changed) + bundle.hours[2:]))
            self.assertEqual(result["status"], "blocked")
        bundle = fixture()
        self.assertIsNone(
            evaluate(replace(bundle, hours=bundle.hours[:3] + bundle.hours[4:]))["selected_window"]
        )

    def test_review_equipment_monitor_and_stale(self):
        result = rank_windows(
            fixture(),
            (Candidate(NOW, NOW + timedelta(hours=2), 1, 1),),
            POLICY,
            as_of=NOW,
            area_ha=10,
            capacity_ha_hour=1,
        )
        self.assertEqual(result["status"], "blocked")
        result = evaluate(candidates=(Candidate(NOW, NOW + timedelta(hours=2), 0, 1),))
        self.assertEqual(result["status"], "monitor")
        self.assertIsNone(result["selected_window"])
        stale = replace(fixture(), retrieved_at=NOW - timedelta(hours=2))
        self.assertEqual(evaluate(stale)["status"], "insufficient_data")

    def test_timezone_and_duplicate(self):
        hour = fixture().hours[0]
        ist = hour.start_at.astimezone(timezone(timedelta(hours=5, minutes=30)))
        self.assertEqual(replace(hour, start_at=ist), hour)
        with self.assertRaises(ValueError):
            replace(fixture(), hours=(hour, hour))
        with self.assertRaises(ValueError):
            replace(hour, start_at=NOW.replace(tzinfo=None))
        with self.assertRaises(ValueError):
            replace(hour, interval_hours=8)

    def test_stull_validity_and_reference(self):
        # Approximate published Stull chart at T=20 C, RH=50%, Tw ~= 13.7 C.
        self.assertAlmostEqual(wet_bulb_stull(20, 50), 13.7, delta=0.1)
        with self.assertRaises(ValueError):
            wet_bulb_stull(20, 100)
        with self.assertRaises(ValueError):
            wet_bulb_stull(-10, 10)

    def test_future_retrieval(self):
        with self.assertRaises(ValueError):
            freshness(fixture(), NOW - timedelta(seconds=1))

    def test_half_hour_utc_grid(self):
        shifted = tuple(
            replace(h, start_at=h.start_at + timedelta(minutes=30)) for h in fixture().hours
        )
        bundle = replace(fixture(), hours=shifted)
        start = NOW + timedelta(minutes=30)
        result = evaluate(bundle, (Candidate(start, start + timedelta(hours=2), 1, 1),))
        self.assertEqual(result["status"], "recommended")


if __name__ == "__main__":
    unittest.main()
