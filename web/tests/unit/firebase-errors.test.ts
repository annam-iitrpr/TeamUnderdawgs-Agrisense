import { describe, expect, it } from "vitest";
import { authErrorKey } from "@/lib/firebase";
import { en } from "@/lib/locale/en";

describe("authErrorKey", () => {
  it("maps phone verification failures to safe farmer-facing messages", () => {
    expect(authErrorKey("auth/invalid-verification-code")).toBe("authInvalidCode");
    expect(authErrorKey("auth/code-expired")).toBe("authCodeExpired");
    expect(en.authInvalidCode).toBeTruthy();
  });

  it("maps the conditions a farmer can act on to their own message", () => {
    expect(authErrorKey("auth/invalid-phone-number")).toBe("authInvalidPhone");
    expect(authErrorKey("auth/too-many-requests")).toBe("authTooManyAttempts");
  });

  it("treats a network failure as unreachable rather than a credential problem", () => {
    expect(authErrorKey("auth/network-request-failed")).toBe("errorUnreachable");
  });

  it("falls back to a generic message for anything unrecognised", () => {
    expect(authErrorKey("auth/some-future-code")).toBe("errorTitle");
    expect(authErrorKey(undefined)).toBe("errorTitle");
    expect(authErrorKey(null)).toBe("errorTitle");
    expect(authErrorKey(42)).toBe("errorTitle");
  });

  it("resolves every mapped key to a real translation", () => {
    const codes = [
      "auth/invalid-phone-number",
      "auth/invalid-verification-code",
      "auth/code-expired",
      "auth/too-many-requests",
      "auth/network-request-failed",
      "auth/unmapped",
    ];
    for (const code of codes) {
      const key = authErrorKey(code);
      expect(en[key], `${code} -> ${key} has no English string`).toBeTruthy();
    }
  });
});
