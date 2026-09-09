import { describe, expect, it } from "vitest";
import {
  acresToHectares,
  daysFromToday,
  formatArea,
  formatDate,
  formatInterval,
  formatLitres,
  formatMoney,
  formatMoneyRange,
  formatPercent,
  formatTime,
  hectaresToAcres,
  istDateKey,
} from "@/lib/format";

describe("IST date handling", () => {
  it("keeps the IST calendar date for an instant that is the previous day in UTC", () => {
    // 2026-07-25T01:00:00+05:30 is 2026-07-24T19:30:00Z. Naive UTC slicing
    // would report the 24th and move a spray window onto the wrong morning.
    expect(istDateKey("2026-07-24T19:30:00Z")).toBe("2026-07-25");
  });

  it("keeps the IST calendar date across the UTC midnight boundary", () => {
    // 00:30Z on the 25th is 06:00 IST on the same date.
    expect(istDateKey("2026-07-25T00:30:00Z")).toBe("2026-07-25");
  });

  it("does not roll over until 18:30Z, which is IST midnight", () => {
    expect(istDateKey("2026-07-25T18:29:00Z")).toBe("2026-07-25");
    expect(istDateKey("2026-07-25T18:30:00Z")).toBe("2026-07-26");
  });

  it("renders clock time in IST, not UTC", () => {
    // 00:30Z -> 06:00 IST
    expect(formatTime("2026-07-25T00:30:00Z")).toBe("06:00");
  });

  it("returns the unknown marker for an unparseable timestamp", () => {
    expect(istDateKey("not-a-date")).toBeNull();
    expect(formatTime("not-a-date")).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("daysFromToday", () => {
  const now = new Date("2026-07-25T04:00:00Z"); // 09:30 IST on the 25th

  it("counts an instant later the same IST day as today", () => {
    expect(daysFromToday("2026-07-25T17:00:00Z", now)).toBe(0); // 22:30 IST
  });

  it("counts calendar days, so 01:00 IST tomorrow is 1 and not 0", () => {
    // 2026-07-25T19:30:00Z is 01:00 IST on the 26th.
    expect(daysFromToday("2026-07-25T19:30:00Z", now)).toBe(1);
  });

  it("returns negative values for past dates", () => {
    expect(daysFromToday("2026-07-23T04:00:00Z", now)).toBe(-2);
  });
});

describe("formatInterval", () => {
  it("renders a same-day window once with both times", () => {
    const text = formatInterval("2026-07-25T00:30:00Z", "2026-07-25T02:30:00Z", "en");
    expect(text).toBe("25 July, 06:00 to 08:00");
  });

  it("names both dates when the window crosses IST midnight", () => {
    const text = formatInterval("2026-07-25T17:00:00Z", "2026-07-25T20:00:00Z", "en");
    expect(text).toContain("25 July");
    expect(text).toContain("26 July");
  });
});

describe("area", () => {
  it("round-trips acres and hectares", () => {
    expect(hectaresToAcres(acresToHectares(2.5))).toBeCloseTo(2.5, 10);
  });

  it("converts one acre to the standard hectare value", () => {
    expect(acresToHectares(1)).toBeCloseTo(0.4046856422, 9);
  });

  it("always shows the unit", () => {
    expect(formatArea(1.2, "ha", "en")).toBe("1.2 ha");
    expect(formatArea(1.2, "acre", "en")).toBe("1.2 acre");
  });

  it("renders unknown rather than zero for a missing area", () => {
    expect(formatArea(null, "ha", "en")).toBe("—");
    expect(formatArea(undefined, "ha", "en")).toBe("—");
    expect(formatArea(Number.NaN, "ha", "en")).toBe("—");
  });
});

describe("money", () => {
  it("renders rupees", () => {
    expect(formatMoney(30_000, "en")).toContain("30,000");
  });

  it("keeps a negative margin negative", () => {
    // A loss-making season is a valid outcome and must not be clamped.
    const text = formatMoney(-4_500, "en");
    expect(text).toMatch(/-|−/);
    expect(text).toContain("4,500");
  });

  it("renders unknown rather than zero for a missing value", () => {
    expect(formatMoney(null, "en")).toBe("—");
  });

  it("collapses a range whose bounds are equal", () => {
    expect(formatMoneyRange(1000, 1000, "en")).toBe(formatMoney(1000, "en"));
  });

  it("falls back to the single known bound", () => {
    expect(formatMoneyRange(1000, null, "en")).toBe(formatMoney(1000, "en"));
    expect(formatMoneyRange(null, 2000, "en")).toBe(formatMoney(2000, "en"));
  });

  it("renders unknown when neither bound is known", () => {
    expect(formatMoneyRange(null, null, "en")).toBe("—");
  });
});

describe("percent", () => {
  it("renders a percentage", () => {
    expect(formatPercent(60, "en")).toBe("60%");
  });

  it("renders unknown when the denominator made ROI undefined", () => {
    // roi_percent is null when cost <= 0 or the cost basis is incomplete.
    expect(formatPercent(null, "en")).toBe("—");
  });
});

describe("litres", () => {
  it("keeps small volumes as plain litres", () => {
    expect(formatLitres(40_000, "en")).toContain("40,000");
  });

  it("abbreviates a lakh", () => {
    expect(formatLitres(1_240_000, "en")).toBe("12.4 lakh L");
  });

  it("abbreviates a crore", () => {
    expect(formatLitres(20_000_000, "en")).toBe("2 crore L");
  });

  it("renders unknown for a missing volume", () => {
    expect(formatLitres(null, "en")).toBe("—");
  });
});
