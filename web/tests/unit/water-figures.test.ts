/**
 * The water unit conversions.
 *
 * These exist because three screens assumed millimetres everywhere while the
 * engine speaks three different units, and the mistakes were invisible: a
 * figure already in litres was labelled "L" and then re-converted as a depth,
 * printing two different numbers for the same value, and a cubic-metre seasonal
 * total was multiplied by ten thousand and labelled "mm".
 */
import { describe, expect, it } from "vitest";
import {
  formatLitres,
  litresForArea,
  litresFromMeasurement,
  relativeWaterScore,
  splitDayReason,
  LITRES_PER_MM_PER_HECTARE,
} from "@/features/planning/water-figures";

describe("litresFromMeasurement", () => {
  it("leaves a litre figure alone, because it already covers the area", () => {
    // The per-day water figures come from the engine as litres for the
    // allocated area. Scaling by area again multiplies by it twice.
    expect(litresFromMeasurement(5000, "L", 2.5)).toBe(5000);
    expect(litresFromMeasurement(5000, "L", 100)).toBe(5000);
  });

  it("converts cubic metres at 1000 litres each, independent of area", () => {
    expect(litresFromMeasurement(3, "m³", 1)).toBe(3000);
    expect(litresFromMeasurement(3, "m³", 40)).toBe(3000);
    expect(litresFromMeasurement(3, "m3", 1)).toBe(3000);
  });

  it("scales millimetres by area, since only a depth needs one", () => {
    expect(litresFromMeasurement(1, "mm", 1)).toBe(LITRES_PER_MM_PER_HECTARE);
    expect(litresFromMeasurement(10, "mm", 2)).toBe(200_000);
  });

  it("refuses an unrecognised unit rather than guessing", () => {
    // Showing a number in the wrong unit is worse than showing no number.
    expect(litresFromMeasurement(100, "acre-feet", 1)).toBeNull();
    expect(litresFromMeasurement(100, "", 1)).toBeNull();
  });

  it("keeps unknown as unknown", () => {
    expect(litresFromMeasurement(null, "m³", 1)).toBeNull();
    expect(litresFromMeasurement(undefined, "m³", 1)).toBeNull();
    expect(litresFromMeasurement(5, null, 1)).toBeNull();
  });

  it("does not turn a real zero into unknown", () => {
    // Zero water required is a claim the engine can legitimately make.
    expect(litresFromMeasurement(0, "m³", 1)).toBe(0);
  });

  it("never double-counts area for the same underlying volume", () => {
    // 3 m³ over 2 ha is 3000 L however it is expressed.
    const asCubic = litresFromMeasurement(3, "m³", 2);
    const asLitres = litresFromMeasurement(3000, "L", 2);
    expect(asCubic).toBe(asLitres);
  });
});

describe("splitDayReason", () => {
  it("separates the date from the reason the engine packed together", () => {
    expect(splitDayReason("2026-09-10:rain_or_et0_missing")).toEqual({
      date: "2026-09-10",
      reason: "rain_or_et0_missing",
    });
  });

  it("keeps a bare reason as a reason rather than mistaking it for a date", () => {
    expect(splitDayReason("initial_storage_unknown")).toEqual({
      date: null,
      reason: "initial_storage_unknown",
    });
  });

  it("handles a date with an empty reason", () => {
    expect(splitDayReason("2026-09-10:")).toEqual({ date: "2026-09-10", reason: null });
  });

  it("treats absent as absent", () => {
    expect(splitDayReason(null)).toEqual({ date: null, reason: null });
    expect(splitDayReason(undefined)).toEqual({ date: null, reason: null });
    expect(splitDayReason("")).toEqual({ date: null, reason: null });
  });
});

describe("formatLitres", () => {
  it("reads at a human scale", () => {
    expect(formatLitres(450)).toBe("450 L");
    expect(formatLitres(12_000)).toBe("12 thousand L");
    expect(formatLitres(2_500_000)).toBe("2.5 million L");
    expect(formatLitres(30_000_000)).toBe("30 million L");
  });
});

describe("relativeWaterScore", () => {
  it("scores the least thirsty of the set highest", () => {
    expect(relativeWaterScore(100, [100, 200, 300])).toBe(1);
    expect(relativeWaterScore(300, [100, 200, 300])).toBe(0);
  });

  it("declines to score a single candidate, having nothing to compare to", () => {
    // A lone crop is neither thirsty nor frugal; claiming either would invent
    // an absolute threshold the engine never supplied.
    expect(relativeWaterScore(100, [100])).toBeNull();
  });

  it("keeps unknown unknown", () => {
    expect(relativeWaterScore(null, [100, 200])).toBeNull();
  });
});

describe("litresForArea", () => {
  it("is one millimetre over one hectare equals ten thousand litres", () => {
    expect(litresForArea(1, 1)).toBe(10_000);
  });
});
