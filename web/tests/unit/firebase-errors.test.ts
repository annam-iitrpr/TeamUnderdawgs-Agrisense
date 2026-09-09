import { describe, expect, it } from "vitest";
import { authErrorKey } from "@/lib/firebase";
import { en } from "@/lib/locale/en";

describe("authErrorKey", () => {
  it("does not reveal whether an email address is registered", () => {
    // The account-enumeration guard: a wrong password and an unknown address
    // must produce the same message, or the response distinguishes registered
    // addresses from unregistered ones.
    const unknownAddress = authErrorKey("auth/user-not-found");
    const wrongPassword = authErrorKey("auth/wrong-password");
    const invalidCredential = authErrorKey("auth/invalid-credential");

    expect(unknownAddress).toBe("authInvalidCredentials");
    expect(wrongPassword).toBe("authInvalidCredentials");
    expect(invalidCredential).toBe("authInvalidCredentials");
    expect(en[unknownAddress]).toBe(en[wrongPassword]);
  });

  it("maps the conditions a farmer can act on to their own message", () => {
    expect(authErrorKey("auth/invalid-email")).toBe("authInvalidEmail");
    expect(authErrorKey("auth/weak-password")).toBe("authWeakPassword");
    expect(authErrorKey("auth/email-already-in-use")).toBe("authEmailInUse");
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
      "auth/invalid-email",
      "auth/user-not-found",
      "auth/wrong-password",
      "auth/invalid-credential",
      "auth/weak-password",
      "auth/email-already-in-use",
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
