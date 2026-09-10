import { describe, expect, it } from "vitest";
import { explainMissing } from "@/lib/missing-reasons";

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
});
