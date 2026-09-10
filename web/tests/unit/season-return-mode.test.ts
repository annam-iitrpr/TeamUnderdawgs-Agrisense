/**
 * What a whole-season rupee total is allowed to claim.
 *
 * These exist because the crop card used to print the engine's modelled season
 * profit as its headline, in the largest type on the card, for a farmer who had
 * entered no budget and recorded no costs. Nothing in the arithmetic was
 * theirs — it is a resample of published yield, price and cost rows scaled by
 * area — and set as the headline it read as a promise about their field. The
 * gate below is the rule that stops that happening again, so it is tested
 * rather than left to a reading of the JSX.
 */
import { describe, expect, it } from "vitest";
import { seasonReturnMode } from "@/features/planning/crop-card";
import type { Economics, Estimate } from "@/lib/api/contract";

function estimate(overrides: Partial<Estimate> = {}): Estimate {
  return {
    p10: 80_000,
    p50: 118_500,
    p90: 160_000,
    unit: "INR",
    basis: "scenario",
    target: "whole_season_profit",
    input_completeness: 1,
    ...overrides,
  };
}

function economics(profit: Estimate): Economics {
  return {
    cost: estimate({ target: "whole_season_cost" }),
    revenue: estimate({ target: "whole_season_revenue" }),
    profit,
    roi: estimate({ unit: "%", target: "whole_season_roi" }),
    price: { value: null, unit: "INR/kg", missing_reason: "dated_product_form_price_required" },
  };
}

describe("seasonReturnMode", () => {
  it("withholds a scenario total from a farmer who has given nothing of their own", () => {
    // The figure exists and is deliberately not shown. This is the state every
    // card is in before onboarding collects a budget.
    expect(seasonReturnMode(economics(estimate()), null)).toBe("withheld");
    expect(seasonReturnMode(economics(estimate()), undefined)).toBe("withheld");
  });

  it("shows a scenario as indicative once the farmer has stated a budget", () => {
    expect(seasonReturnMode(economics(estimate()), 45_000)).toBe("indicative");
  });

  it("never treats a zero or negative budget as a budget", () => {
    // Zero is a farmer saying they can spend nothing, not a farmer supplying
    // the input the season total needs; a negative one is not a budget at all.
    expect(seasonReturnMode(economics(estimate()), 0)).toBe("withheld");
    expect(seasonReturnMode(economics(estimate()), -1)).toBe("withheld");
    expect(seasonReturnMode(economics(estimate()), Number.NaN)).toBe("withheld");
  });

  it("lets a figure built from records speak plainly, budget or no budget", () => {
    // Once the basis leaves "scenario" the number came from somewhere real, and
    // withholding it would hide the farmer's own history from them.
    expect(seasonReturnMode(economics(estimate({ basis: "observed" })), null)).toBe("own");
    expect(
      seasonReturnMode(economics(estimate({ basis: "empirically_calibrated" })), null),
    ).toBe("own");
  });

  it("keeps an absent figure absent rather than withheld", () => {
    // "We are not showing you this yet" and "the engine could not work it out"
    // are different sentences, and only the second one has the engine's own
    // reason to attach to it.
    const missing = estimate({
      p10: null,
      p50: null,
      p90: null,
      missing_reason: "paired_yield_price_cost_scenarios_and_cost_completeness_required",
    });
    expect(seasonReturnMode(economics(missing), 45_000)).toBe("unavailable");
    expect(seasonReturnMode(null, 45_000)).toBe("unavailable");
    expect(seasonReturnMode(undefined, null)).toBe("unavailable");
  });

  it("does not mistake a real loss for a missing figure", () => {
    // A season that loses money is an outcome the engine is entitled to state.
    expect(seasonReturnMode(economics(estimate({ p50: -12_000 })), 45_000)).toBe("indicative");
    expect(seasonReturnMode(economics(estimate({ p50: 0 })), 45_000)).toBe("indicative");
  });
});
