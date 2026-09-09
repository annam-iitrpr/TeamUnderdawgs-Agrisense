"""Synthetic arithmetic fixtures; these tests provide no empirical efficacy evidence."""

import unittest
from decimal import Decimal as D

from agrisense.science.economics import (
    CostLine,
    crop_budget,
    incremental_value,
    price_per_kg,
    reconcile_costs,
)
from agrisense.science.stress import (
    heat_stress,
    nitrogen_reference,
    source_drought_index,
    vpd_kpa,
    yield_risk,
)
from agrisense.science.units import irrigation_litres, radiation_wm2, soil_mass_kg_ha, wind_kmh
from agrisense.science.water import RootZone, fao56_et0, root_zone_day


class StressTests(unittest.TestCase):
    def test_golden_temperatures(self):
        for temperature, expected in ((32, 0), (35, 4.5), (38, 9)):
            self.assertEqual(heat_stress("cotton", temperature, 20).day, expected)
        for temperature, expected in ((15, 0), (17.5, 4.5), (20, 9)):
            self.assertEqual(heat_stress("wheat", 25, temperature).night, expected)
        for temperature, expected in ((4, 0), (0.5, 4.5), (-3, 9)):
            self.assertEqual(heat_stress("cotton", 30, temperature).frost, expected)
        self.assertIsNone(heat_stress("rice", 30, -3).frost)

    def test_monotonic_and_missing(self):
        for crop in ("rice", "wheat", "cotton", "maize", "soybean"):
            scores = [heat_stress(crop, t, 10).day for t in range(10, 61)]
            self.assertEqual(scores, sorted(scores))
            self.assertTrue(all(0 <= x <= 9 for x in scores))
        self.assertIsNone(heat_stress("cotton", None, 20).day)
        self.assertIsNone(yield_risk("cotton", (2400, None, 6.2, 0.07))["score"])
        self.assertEqual(yield_risk("cotton", (2400, 900, 6.2, 0.07))["score"], 0)
        for temperature in (float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                heat_stress("cotton", temperature, 20)

    def test_vpd_and_invalid_source(self):
        self.assertAlmostEqual(vpd_kpa(20, 50), 1.169, places=3)
        self.assertEqual(vpd_kpa(30, 100), 0)
        self.assertIsNone(source_drought_index(1, 2, 3, 0, parse="P-E+SM/T")["value"])
        self.assertIsNone(nitrogen_reference(1000, 0, 1, 1)["index"])


class WaterTests(unittest.TestCase):
    def test_units(self):
        self.assertEqual(irrigation_litres(1, 1), 10000)
        self.assertEqual(irrigation_litres(10, 0.4), 40000)
        self.assertEqual(wind_kmh(10, "m/s"), 36)
        self.assertIsNone(wind_kmh(None, "m/s"))
        self.assertEqual(radiation_wm2(1600, 8), 200)
        self.assertEqual(soil_mass_kg_ha(0.1, 1300, 0.2), 260)

    def test_balance_and_unknown(self):
        zone = RootZone(0.3, 0.1, 0.5, 0.5, 0.8)
        result = root_zone_day(zone, depletion_mm=50, et0_mm=5, kc=1, rain_mm=0, area_ha=0.4)
        self.assertAlmostEqual(result["depletion_mm"], 55)
        self.assertAlmostEqual(result["ks"], 0.9)
        self.assertAlmostEqual(result["gross_irrigation_mm"], 68.75)
        for paddy, reason in (
            (False, "initial_storage_unknown"),
            (True, "paddy_management_required"),
        ):
            result = root_zone_day(
                zone, depletion_mm=None, et0_mm=5, kc=1, rain_mm=0, area_ha=1, flooded_paddy=paddy
            )
            self.assertIsNone(result["litres"])
            self.assertEqual(result["reason"], reason)

    def test_et0_independent_fao_example_18(self):
        # FAO-56 example 18, rounded supplied intermediates, expected about 3.9 mm/day.
        actual = fao56_et0(
            tmean_c=16.9,
            net_radiation_mj_m2_day=13.28,
            soil_heat_mj_m2_day=0,
            wind_2m_m_s=2.078,
            es_kpa=1.997,
            ea_kpa=1.409,
            slope_kpa_c=0.122,
            psychrometric_kpa_c=0.0666,
        )
        # https://www.fao.org/4/x0490e/x0490e08.htm, published result 3.88.
        self.assertAlmostEqual(actual, 3.88, delta=0.02)


class EconomicsTests(unittest.TestCase):
    def budget(self, **overrides):
        args = {
            "yield_kg_ha": "4000",
            "area_ha": "1",
            "price_inr_kg": "20",
            "costs": (CostLine("all", D(50000), "planned"),),
            "costs_complete": True,
            "product_form": "paddy",
            "price_product_form": "paddy",
        }
        args.update(overrides)
        return crop_budget(**args)

    def test_golden(self):
        result = self.budget()
        self.assertEqual(result["revenue_inr"], D(80000))
        self.assertEqual(result["net_profit_inr"], D(30000))
        self.assertEqual(result["roi_percent"], D(60))
        self.assertEqual(price_per_kg("2000", "INR/quintal"), D(20))
        result = incremental_value(
            timed_yield_kg=4100,
            comparator_yield_kg=4000,
            price_inr_kg=20,
            timed_cost_inr=51500,
            comparator_cost_inr=50000,
            comparator="no spray",
        )
        self.assertEqual(result["value_inr"], D(500))

    def test_zero_missing_and_form(self):
        result = self.budget(yield_kg_ha=0)
        self.assertEqual(result["net_profit_inr"], D(-50000))
        self.assertEqual(result["roi_percent"], D(-100))
        self.assertIsNone(result["break_even_price_inr_kg"])
        self.assertIsNone(self.budget(costs_complete=False)["roi_percent"])
        with self.assertRaises(ValueError):
            self.budget(price_product_form="milled_rice")
        with self.assertRaises(TypeError):
            self.budget(price_inr_kg=20.1)

    def test_actual_replaces_plan_and_deduplicates(self):
        planned = CostLine("seed", D(100), "planned")
        actual = CostLine("seed", D(90), "actual", event_id="event-1")
        self.assertEqual(reconcile_costs((planned, actual, actual)), (actual,))
        revised = CostLine("seed", D(95), "actual", revision=2, event_id="event-2")
        self.assertEqual(reconcile_costs((revised, actual)), (revised,))


if __name__ == "__main__":
    unittest.main()
