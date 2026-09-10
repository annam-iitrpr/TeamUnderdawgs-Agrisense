/**
 * How rupees reach the screen on the planning cards.
 *
 * Two things are being pinned here. Indian grouping: ₹1,18,500 is a figure an
 * Indian farmer reads at a glance and ₹118,500 is one they have to count, and
 * the app has one money formatter so that stays true everywhere. And the unit
 * behind a per-quintal price: the mandi feed is INR/quintal throughout, so a
 * measurement arriving in anything else is refused rather than relabelled —
 * calling a per-kilogram figure per-quintal is wrong by a hundred, and a farmer
 * would find that out at the mandi gate.
 */
import { describe, expect, it } from "vitest";
import { formatEstimateValue } from "@/features/planning/estimate-band";
import { rupeesPerQuintal } from "@/features/market/market-price-panel";

describe("formatEstimateValue", () => {
  it("groups rupees the Indian way", () => {
    expect(formatEstimateValue(118_500, "INR")).toBe("₹1,18,500");
    expect(formatEstimateValue(2_425, "INR")).toBe("₹2,425");
    expect(formatEstimateValue(12_34_567, "INR")).toBe("₹12,34,567");
  });

  it("renders a loss as a loss", () => {
    // Never clamped: a season that lost money is a real answer.
    expect(formatEstimateValue(-12_000, "INR")).toContain("12,000");
    expect(formatEstimateValue(-12_000, "INR").startsWith("-₹")).toBe(true);
  });

  it("keeps a rate readable without inventing a unit", () => {
    expect(formatEstimateValue(42.5, "%")).toBe("42.5%");
    expect(formatEstimateValue(1.25, "ratio")).toBe("1.3");
  });

  it("carries the unit for a quantity, so a bare number cannot be misread", () => {
    expect(formatEstimateValue(550.4, "mm")).toBe("550 mm");
    expect(formatEstimateValue(4_250, "kg/ha")).toBe("4,250 kg/ha");
    // An unrecognised unit is still shown rather than dropped.
    expect(formatEstimateValue(3.5, "quintal/ha")).toBe("3.5 quintal/ha");
  });
});

describe("rupeesPerQuintal", () => {
  it("says a price the way a farmer says it", () => {
    expect(rupeesPerQuintal({ value: 2425, unit: "INR/quintal" })).toBe("₹2,425/quintal");
    expect(rupeesPerQuintal({ value: 118500, unit: "INR/quintal" })).toBe("₹1,18,500/quintal");
  });

  it("refuses a price in some other unit rather than relabelling it", () => {
    expect(rupeesPerQuintal({ value: 24.25, unit: "INR/kg" })).toBeNull();
    expect(rupeesPerQuintal({ value: 2425, unit: "" })).toBeNull();
  });

  it("keeps unknown as unknown, never as ₹0", () => {
    expect(rupeesPerQuintal(null)).toBeNull();
    expect(rupeesPerQuintal(undefined)).toBeNull();
    expect(
      rupeesPerQuintal({ value: null, unit: "INR/quintal", missing_reason: "no_data" }),
    ).toBeNull();
  });
});
