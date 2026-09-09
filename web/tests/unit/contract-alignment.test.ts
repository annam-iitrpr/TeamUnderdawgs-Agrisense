import { describe, expect, it } from "vitest";
import { CONSUMED_PATHS, pageQuery } from "@/lib/api/routes";
import { newIdempotencyKey } from "@/lib/api/client";
import { emptyMeta } from "@/lib/api/envelope";
import type { AreaUnit, DateConfidence, LanguageCode } from "@/lib/api/contract";

/**
 * These tests exist to catch contract DRIFT, not to restate the contract.
 *
 * The strongest guard is the `satisfies ReadonlyArray<keyof paths>` on
 * CONSUMED_PATHS in routes.ts: if Phase 3 regenerates and renames a route,
 * typecheck fails before any test runs. The runtime assertions below cover the
 * bounds the contract states in prose, which types alone cannot express.
 */
describe("consumed route paths", () => {
  it("declares every path under the versioned prefix", () => {
    for (const path of CONSUMED_PATHS) {
      expect(path.startsWith("/api/v1/"), `${path} is not under /api/v1`).toBe(true);
    }
  });

  it("declares no duplicates", () => {
    expect(new Set(CONSUMED_PATHS).size).toBe(CONSUMED_PATHS.length);
  });

  it("covers the routes the demo path depends on", () => {
    // Onboarding -> comparison -> dashboard -> recommendation is the spine of
    // the demo. Losing any of these silently would be expensive to notice late.
    for (const required of [
      "/api/v1/fields",
      "/api/v1/fields/{id}/seasons",
      "/api/v1/planning/compare",
      "/api/v1/seasons/{id}/recommendations/latest",
      "/api/v1/catalog/crops",
    ] as const) {
      expect(CONSUMED_PATHS).toContain(required);
    }
  });
});

describe("idempotency keys", () => {
  it("fall inside the contract's 8-to-128 character bound", () => {
    for (let i = 0; i < 50; i += 1) {
      const key = newIdempotencyKey();
      expect(key.length).toBeGreaterThanOrEqual(8);
      expect(key.length).toBeLessThanOrEqual(128);
    }
  });

  it("does not repeat across calls", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(200);
  });
});

describe("list pagination bounds", () => {
  it("clamps a limit into the contract's 1-to-100 range", () => {
    expect(pageQuery({ limit: 500 }).limit).toBe(100);
    expect(pageQuery({ limit: 0 }).limit).toBe(1);
    expect(pageQuery({ limit: -5 }).limit).toBe(1);
    expect(pageQuery({ limit: 25 }).limit).toBe(25);
  });

  it("omits the limit entirely when the caller does not set one", () => {
    // Sending limit=undefined must not become "limit=undefined" in the query.
    expect(pageQuery().limit).toBeUndefined();
  });

  it("treats a null cursor as absent rather than sending it", () => {
    expect(pageQuery({ cursor: null }).cursor).toBeUndefined();
    expect(pageQuery({ cursor: "abc" }).cursor).toBe("abc");
  });
});

describe("metadata defaults", () => {
  it("defaults data_mode to unavailable, never live", () => {
    // A response carrying no metadata must not present as live data.
    expect(emptyMeta().data_mode).toBe("unavailable");
  });
});

describe("enums that this branch previously guessed wrong", () => {
  // Recorded deliberately: the provisional hand-written types had two area
  // units, "exact" date confidence, and water in litres. The real contract
  // disagreed on all three. These assignments fail typecheck if the contract
  // moves again.
  it("accepts all four contract area units", () => {
    const units: AreaUnit[] = ["ha", "acre", "sqm", "kanal"];
    expect(units).toHaveLength(4);
  });

  it("uses confirmed/estimated/unknown for date confidence", () => {
    const values: DateConfidence[] = ["confirmed", "estimated", "unknown"];
    expect(values).toHaveLength(3);
  });

  it("carries the five farmer languages", () => {
    const langs: LanguageCode[] = ["en", "hi", "mr", "pa", "te"];
    expect(langs).toHaveLength(5);
  });
});
