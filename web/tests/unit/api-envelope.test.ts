import { describe, expect, it } from "vitest";
import {
  ApiError,
  codeForStatus,
  fieldErrors,
  type ApiErrorCode,
} from "@/lib/api/envelope";
import { serializeKey } from "@/lib/api/query";

describe("codeForStatus", () => {
  it("maps each status the contract assigns to a condition", () => {
    expect(codeForStatus(401)).toBe("unauthenticated");
    expect(codeForStatus(403)).toBe("forbidden");
    expect(codeForStatus(404)).toBe("not_found");
    expect(codeForStatus(409)).toBe("version_conflict");
    expect(codeForStatus(422)).toBe("invalid_input");
    expect(codeForStatus(429)).toBe("rate_limited");
    expect(codeForStatus(503)).toBe("dependency_unavailable");
  });

  it("falls back to unknown for an unmapped status", () => {
    expect(codeForStatus(500)).toBe("unknown");
    expect(codeForStatus(418)).toBe("unknown");
  });
});

describe("ApiError retryability", () => {
  const make = (code: ApiErrorCode) => new ApiError({ code, status: 0, message: "x" }).retryable;

  it("treats transient conditions as retryable", () => {
    expect(make("rate_limited")).toBe(true);
    expect(make("dependency_unavailable")).toBe(true);
    expect(make("network")).toBe(true);
  });

  it("does not invite a retry for conditions a retry cannot fix", () => {
    expect(make("unauthenticated")).toBe(false);
    expect(make("forbidden")).toBe(false);
    expect(make("invalid_input")).toBe(false);
    expect(make("not_found")).toBe(false);
    expect(make("version_conflict")).toBe(false);
  });

  it("lets the server override retryability", () => {
    const error = new ApiError({
      code: "invalid_input",
      status: 422,
      message: "x",
      retryable: true,
    });
    expect(error.retryable).toBe(true);
  });

  it("exposes auth and conflict as distinct recoverable conditions", () => {
    expect(new ApiError({ code: "unauthenticated", status: 401, message: "x" }).isAuthFailure).toBe(
      true,
    );
    expect(
      new ApiError({ code: "version_conflict", status: 409, message: "x" }).isVersionConflict,
    ).toBe(true);
    expect(new ApiError({ code: "not_found", status: 404, message: "x" }).isAuthFailure).toBe(false);
  });
});

describe("fieldErrors", () => {
  it("extracts per-input messages from a 422", () => {
    const error = new ApiError({
      code: "invalid_input",
      status: 422,
      message: "check fields",
      details: { area_ha: "Must be greater than zero", sowing_date: ["Not a valid date"] },
    });
    expect(fieldErrors(error)).toEqual({
      area_ha: "Must be greater than zero",
      sowing_date: "Not a valid date",
    });
  });

  it("returns nothing for other error codes", () => {
    const error = new ApiError({
      code: "forbidden",
      status: 403,
      message: "no",
      details: { area_ha: "ignored" },
    });
    expect(fieldErrors(error)).toEqual({});
  });

  it("returns nothing for a non-error value", () => {
    expect(fieldErrors(null)).toEqual({});
    expect(fieldErrors(new Error("plain"))).toEqual({});
  });
});

describe("serializeKey", () => {
  it("distinguishes different subjects", () => {
    const a = serializeKey(["actor1", "recommendation", "field_A", "season_1", 3]);
    const b = serializeKey(["actor1", "recommendation", "field_B", "season_1", 3]);
    expect(a).not.toBe(b);
  });

  it("distinguishes the same field under a different actor", () => {
    // Two tenants must never share a cache entry for the same field id.
    expect(serializeKey(["actor1", "field_A"])).not.toBe(serializeKey(["actor2", "field_A"]));
  });

  it("changes when the input version changes, so a stale evaluation is not reused", () => {
    expect(serializeKey(["a", "eval", "s1", 3])).not.toBe(serializeKey(["a", "eval", "s1", 4]));
  });

  it("drops absent members so a missing season cannot collide with a literal", () => {
    expect(serializeKey(["a", null, "b"])).toBe("a|b");
    expect(serializeKey(["a", undefined, "b"])).toBe("a|b");
  });

  it("is stable for identical keys", () => {
    expect(serializeKey(["a", 1, true])).toBe(serializeKey(["a", 1, true]));
  });
});
