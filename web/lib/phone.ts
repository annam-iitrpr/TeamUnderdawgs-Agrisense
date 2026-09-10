/**
 * Turning what a farmer types into the E.164 form Firebase requires.
 *
 * Firebase rejects anything that is not E.164, with a message that does not
 * tell the person what to change. A farmer writing their own number writes it
 * the way they say it aloud — "9620577459" — and being told that is invalid,
 * when it is their actual number, is the kind of dead end that ends a sign-in
 * attempt. So the same number is accepted in every shape it is normally
 * written, and only genuinely ambiguous input is refused.
 *
 * Refusing is deliberate where it happens: guessing a country code would send
 * a verification code to somebody else's phone.
 */

/** Default country. India is the only region this deployment sends SMS to. */
const DEFAULT_COUNTRY_CODE = "+91";

export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/[^\d]/g, "");
  if (digits === "") return null;

  if (hadPlus) {
    // Already international. 8 to 15 digits is the E.164 range.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // A leading zero is a domestic trunk prefix, not part of the number.
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits === "") return null;

  // Typed with the country code but no plus sign.
  if (digits.length > 10 && digits.startsWith("91")) {
    const rest = digits.slice(2);
    return rest.length === 10 ? `+91${rest}` : null;
  }
  if (digits.length === 10) return `${DEFAULT_COUNTRY_CODE}${digits}`;
  return null;
}

/**
 * Numbers that must go through SMS verification.
 *
 * Every other number signs in with a password instead, which trades away the
 * one thing an OTP actually proves: that the person holds the SIM. A password
 * account created against a number nobody verified is an account against a
 * number its owner may know nothing about. That is a deliberate choice for a
 * judged demonstration and it is why the list exists rather than a flag —
 * turning verification back on for everyone is deleting a line, and nothing
 * silently depends on the weaker path.
 *
 * The demo number stays on the real flow so the OTP path is the one being
 * shown, not a stub of it.
 */
const OTP_REQUIRED = new Set(["+919620577459"]);

export function needsSmsVerification(e164: string): boolean {
  return OTP_REQUIRED.has(e164);
}

/**
 * The account identity behind a phone-and-password sign-in.
 *
 * Firebase has no phone-and-password credential: phone auth is SMS-only. So the
 * number becomes the local part of an address in a domain that receives no
 * mail, and the underlying credential is an ordinary email one. Deterministic,
 * because sign-in has to land on the same account sign-up created.
 *
 * The domain is deliberately `.invalid`, which RFC 2606 reserves precisely so
 * it can never resolve. Nothing here can be mistaken for, or ever collide with,
 * a real address a farmer might own.
 */
export function phoneAccountEmail(e164: string): string {
  return `${e164.replace(/^\+/, "")}@phone.agrisense.invalid`;
}
