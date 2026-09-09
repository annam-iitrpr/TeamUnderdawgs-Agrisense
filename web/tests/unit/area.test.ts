import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_UNITS,
  AREA_UNITS,
  MAX_PLAUSIBLE_HECTARES,
  fromHectares,
  parseArea,
  roundHectares,
  toHectares,
} from "@/lib/area";

describe("unit conversion", () => {
  it("matches the standard acre", () => {
    expect(toHectares(1, "acre")).toBeCloseTo(0.4046856422, 9);
  });

  it("treats a hectare as the identity", () => {
    expect(toHectares(2.5, "ha")).toBe(2.5);
  });

  it("converts square metres", () => {
    expect(toHectares(10_000, "sqm")).toBeCloseTo(1, 10);
  });

  it("uses the Punjab kanal of 5,445 sq ft", () => {
    // 505.857 m^2 = 0.0505857 ha. Recorded explicitly because the 4,500 sq ft
    // kanal used elsewhere in India is ~17% smaller, and picking the wrong one
    // silently misreads the field size.
    expect(toHectares(1, "kanal")).toBeCloseTo(0.0505857, 7);
    expect(toHectares(8, "kanal")).toBeCloseTo(0.4046856, 6); // ~1 acre
  });

  it("round-trips every supported unit", () => {
    for (const unit of AREA_UNITS) {
      expect(fromHectares(toHectares(3.7, unit), unit)).toBeCloseTo(3.7, 8);
    }
  });

  it("flags kanal as regionally ambiguous so the UI can warn", () => {
    expect(AMBIGUOUS_UNITS.has("kanal")).toBe(true);
    expect(AMBIGUOUS_UNITS.has("acre")).toBe(false);
    expect(AMBIGUOUS_UNITS.has("ha")).toBe(false);
  });
});

describe("parseArea", () => {
  it("accepts a plain decimal and reports both the original and the hectares", () => {
    const result = parseArea("2.5", "acre");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The farmer's own number is preserved unchanged for the echo-back.
      expect(result.enteredArea).toBe(2.5);
      expect(result.unit).toBe("acre");
      expect(result.areaHa).toBeCloseTo(1.0117141, 6);
    }
  });

  it("accepts a comma as a decimal separator", () => {
    const result = parseArea("1,5", "ha");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.enteredArea).toBe(1.5);
  });

  it("accepts a leading decimal point", () => {
    const result = parseArea(".5", "ha");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.enteredArea).toBe(0.5);
  });

  it("rejects an empty entry distinctly from a bad one", () => {
    expect(parseArea("", "ha")).toEqual({ ok: false, reason: "empty" });
    expect(parseArea("   ", "ha")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects non-numeric text", () => {
    for (const bad of ["two acres", "2 acres", "abc", "1.2.3", "-", "1e5"]) {
      expect(parseArea(bad, "ha").ok, `${bad} should be rejected`).toBe(false);
    }
  });

  it("rejects zero and negative areas", () => {
    expect(parseArea("0", "ha")).toEqual({ ok: false, reason: "not_positive" });
    expect(parseArea("0.0", "ha")).toEqual({ ok: false, reason: "not_positive" });
    // A minus sign fails the numeric pattern before the sign check.
    expect(parseArea("-3", "ha").ok).toBe(false);
  });

  it("rejects an implausibly large area rather than scoring nonsense", () => {
    const result = parseArea(String(MAX_PLAUSIBLE_HECTARES + 1), "ha");
    expect(result).toEqual({ ok: false, reason: "implausibly_large" });
  });

  it("applies the plausibility guard after conversion, not before", () => {
    // 50,000,000 sqm is 5,000 ha, which is under the guard even though the
    // typed number is large. The check must be on the normalised value.
    const result = parseArea("50000000", "sqm");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.areaHa).toBeCloseTo(5000, 6);
  });
});

describe("roundHectares", () => {
  it("removes float artefacts without losing useful precision", () => {
    // 2.5 acres is 1.011714105500 ha; six decimals is ~1 m^2 of resolution.
    expect(roundHectares(toHectares(2.5, "acre"))).toBe(1.011714);
  });

  it("leaves an already-clean value alone", () => {
    expect(roundHectares(1.5)).toBe(1.5);
  });

  it("keeps a small field representable", () => {
    // 100 sqm = 0.01 ha must not round to zero.
    expect(roundHectares(toHectares(100, "sqm"))).toBe(0.01);
  });
});
