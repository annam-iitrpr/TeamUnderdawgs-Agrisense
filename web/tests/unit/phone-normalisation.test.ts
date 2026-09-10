/**
 * Turning what a farmer types into E.164.
 *
 * Firebase requires E.164 and rejects anything else with a message that does
 * not tell the person what to change. A farmer writing their own number will
 * write it the way they say it aloud, so the same number arrives in several
 * shapes and all of them have to work.
 */
import { describe, expect, it } from "vitest";
import { toE164, needsSmsVerification, phoneAccountEmail } from "@/lib/phone";

describe("toE164", () => {
  it("accepts the same Indian number however it is written", () => {
    for (const written of [
      "9620577459",
      "09620577459",
      "919620577459",
      "+919620577459",
      "+91 96205 77459",
      "+91-96205-77459",
      "  9620577459  ",
      "(+91) 96205 77459",
    ]) {
      expect(toE164(written)).toBe("+919620577459");
    }
  });

  it("keeps a non-Indian international number as given", () => {
    expect(toE164("+14155552671")).toBe("+14155552671");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("refuses a number it cannot read rather than guessing a country", () => {
    // Guessing would send someone else's phone a code.
    expect(toE164("12345")).toBeNull();
    expect(toE164("962057745")).toBeNull(); // nine digits
    expect(toE164("96205774591")).toBeNull(); // eleven, not 91-prefixed
    expect(toE164("+1")).toBeNull();
  });

  it("treats blank and non-numeric as nothing entered", () => {
    expect(toE164("")).toBeNull();
    expect(toE164("   ")).toBeNull();
    expect(toE164("not a number")).toBeNull();
    expect(toE164("+")).toBeNull();
    expect(toE164("0")).toBeNull();
  });

  it("strips only a leading trunk zero, never a meaningful digit", () => {
    // "0" prefixed domestic dialling is not part of the number, but a zero
    // inside it is.
    expect(toE164("09000000000")).toBe("+919000000000");
    expect(toE164("9000000000")).toBe("+919000000000");
  });

  it("does not mistake a 91-prefixed foreign number for an Indian one", () => {
    // +91 followed by ten digits is India; anything else with a leading 91 and
    // the wrong length is ambiguous and refused.
    expect(toE164("911234")).toBeNull();
  });
});

describe("phone accounts", () => {
  it("keeps only the demo number on SMS verification", () => {
    expect(needsSmsVerification("+919620577459")).toBe(true);
    expect(needsSmsVerification("+919999988888")).toBe(false);
  });

  it("derives one stable account identity per number", () => {
    // Sign-in must land on the account sign-up created, so the same number
    // written in any of its usual shapes has to reduce to one identity.
    const written = ["9620577459", "09620577459", "+91 96205 77459", "919620577459"];
    const identities = new Set(written.map((raw) => phoneAccountEmail(toE164(raw)!)));
    expect(identities.size).toBe(1);
    expect([...identities][0]).toBe("919620577459@phone.agrisense.invalid");
  });

  it("uses a domain that can never resolve", () => {
    // RFC 2606 reserves .invalid, so this can neither collide with an address a
    // farmer owns nor accidentally be mailed.
    expect(phoneAccountEmail("+919999988888").endsWith(".invalid")).toBe(true);
  });
});
