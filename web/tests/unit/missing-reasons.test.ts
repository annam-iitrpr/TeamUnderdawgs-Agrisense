import { describe, expect, it } from "vitest";
import { explainCode, explainMissing } from "@/lib/missing-reasons";

describe("explainMissing", () => {
  it("says what is missing and who can supply it", () => {
    expect(explainMissing("initial_storage_unknown")).toContain("soil moisture reading");
    expect(explainMissing("soil_ph_missing")).toContain("soil test");
    expect(explainMissing("cash_budget_missing_or_insufficient")).toContain("budget");
  });

  it("falls through to a spaced code rather than hiding an unknown gap", () => {
    // A code nobody has written a phrase for must still reach the screen;
    // swallowing it would make a real gap invisible.
    expect(explainMissing("some_brand_new_engine_code")).toBe("some brand new engine code");
  });

  it("strips the date the engine prefixes onto per-day reasons", () => {
    expect(explainMissing("2026-09-10:rain_or_et0_missing")).toContain("rain or evaporation");
    expect(explainMissing("2026-09-10:brand_new_code")).toBe("brand new code");
  });

  it("treats absent and empty as nothing to say", () => {
    expect(explainMissing(null)).toBeNull();
    expect(explainMissing(undefined)).toBeNull();
    expect(explainMissing("")).toBeNull();
    expect(explainMissing("2026-09-10:")).toBeNull();
  });

  it("never returns a raw snake_case string for a known code", () => {
    for (const code of [
      "reviewed_regional_crop_reference_missing",
      "paired_yield_price_cost_scenarios_and_cost_completeness_required",
      "confirmed_product_selection_required",
      "provider_value_invalid",
    ]) {
      expect(explainMissing(code)).not.toContain("_");
    }
  });

  it("names the weather service behind its own failure code", () => {
    expect(explainMissing("meteoblue:no_data")).toBe(
      "the meteoblue weather service returned no data for your field",
    );
    expect(explainMissing("open_meteo:forecast_not_supported")).toContain(
      "does not supply an hourly forecast",
    );
  });

  it("does not mistake a scenario setting for a weather outage", () => {
    // `draws:2000` and `cost_basis:market` share the prefixed shape but are
    // settings, not providers. Phrasing them as an outage would be a lie.
    expect(explainMissing("draws:2000")).toBe("draws: 2000");
    expect(explainMissing("cost_basis:market")).toBe("cost basis: market");
    expect(explainMissing("draws:2000")).not.toContain("weather");
  });

  it("phrases the assumptions the water screen shows", () => {
    // The seven daily figures are alternatives; a farmer who adds them up
    // overestimates the season by roughly sevenfold.
    expect(explainMissing("daily_values_are_replenishment_alternatives_do_not_sum")).toContain(
      "do not add them up",
    );
    expect(explainMissing("no_future_irrigation_assumed")).not.toContain("_");
    expect(explainMissing("standard_demand_scenario")).not.toContain("_");
  });

  it("phrases the gaps the planning cards notice for themselves", () => {
    // These are not engine codes. A crop calendar that was never published for
    // a district arrives as a null interval with no reason attached, and there
    // is no yield anywhere in the economics contract. Both used to render as
    // "Not known", which names neither the gap nor who can close it.
    expect(explainMissing("reviewed_yield_per_hectare_unavailable")).toContain("yield");
    expect(explainMissing("sowing_window_not_published_for_your_area")).toContain("sowing");
    expect(explainMissing("harvest_window_not_published_for_your_area")).toContain("harvest");
    expect(explainMissing("season_water_requirement_unavailable")).toContain("rainfall");
    expect(explainMissing("no_mandi_reported_this_crop_today")).toContain("mandi");
    for (const code of [
      "reviewed_yield_per_hectare_unavailable",
      "season_length_needs_sowing_and_harvest_windows",
      "suitability_not_scored_for_this_field",
      "figure_not_supplied",
    ]) {
      expect(explainMissing(code)).not.toContain("_");
    }
  });

  it("tells a farmer which of their own numbers unlocks a season return", () => {
    // The card withholds a modelled season total until the farmer has given a
    // budget or recorded costs, so this phrase is the whole explanation they
    // get for a missing figure. It has to name the action, not the shortfall.
    const phrase = explainMissing("season_return_needs_your_budget_or_recorded_costs") ?? "";
    expect(phrase).toContain("spend");
    expect(phrase).toContain("record");
    expect(phrase).not.toContain("_");
  });

  it("distinguishes a crop with no support price from a stale support price list", () => {
    // "There is no floor under this range" and "the floor we have is four years
    // old" are different situations, and only one of them means the government
    // declares nothing for this crop.
    expect(explainMissing("no_msp_is_declared_for_this_crop")).toContain("does not declare");
    expect(explainMissing("current_declared_msp_series_unavailable")).toContain("2022-23");
    expect(explainMissing("prices_are_reported_arrivals_not_a_forecast")).toContain(
      "not a prediction",
    );
  });
});

describe("explainCode", () => {
  it("capitalises a phrase for standalone display", () => {
    expect(explainCode("soil_ph_missing")).toMatch(/^Needs the pH/);
  });

  it("still surfaces a code nobody has phrased yet", () => {
    expect(explainCode("brand_new_code")).toBe("Brand new code");
  });
});
