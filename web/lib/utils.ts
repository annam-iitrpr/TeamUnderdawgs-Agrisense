import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Map a 0-to-9 stress value onto the five-step ramp.
 *
 * `null` means the stress type is not parameterised for this crop (frost on
 * rice and wheat, for example). It returns the neutral token, and callers must
 * pair it with stressWord()'s "Not applicable" — a grey chip on its own would
 * read as "no risk", which is a different claim.
 */
export function stressToken(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "var(--mist)";
  if (value < 2) return "var(--stress-none)";
  if (value < 4) return "var(--stress-low)";
  if (value < 6) return "var(--stress-moderate)";
  if (value < 7.5) return "var(--stress-high)";
  return "var(--stress-severe)";
}

/** The word that goes with the colour, so colour is never the only carrier. */
export function stressWord(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not applicable";
  if (value < 2) return "None";
  if (value < 4) return "Low";
  if (value < 6) return "Moderate";
  if (value < 7.5) return "High";
  return "Severe";
}

/** Severity band key for a 0-to-9 stress value, or null when not applicable. */
export type StressBand = "none" | "low" | "moderate" | "high" | "severe";

export function stressBand(value: number | null | undefined): StressBand | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value < 2) return "none";
  if (value < 4) return "low";
  if (value < 6) return "moderate";
  if (value < 7.5) return "high";
  return "severe";
}

export function titleCase(value: string): string {
  return value
    .split("_")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Clamp for display widths only.
 *
 * A progress bar for an unknown component must not be rendered at all — see
 * the null handling at each call site — so this never turns null into 0.
 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

/* ──────────────────────────── legacy formatters ───────────────────────────
 * Retained from the bootstrap because the pre-existing screens under
 * app/field/** and app/dashboard/** import them. New code must use
 * lib/format.ts instead, which pins Asia/Kolkata explicitly — these helpers
 * format in the *browser's* timezone, which silently shifts the calendar date
 * for a device not set to IST. They are deleted as those screens migrate to
 * /seasons/[id] under P1-04 and P1-05.
 */

function legacyLocaleFor(language = "en"): string {
  return { en: "en-IN", hi: "hi-IN", mr: "mr-IN" }[language] ?? "en-IN";
}

/** @deprecated Use formatTime() from lib/format.ts (IST-pinned). */
export function formatHour(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** @deprecated Use formatDate() from lib/format.ts (IST-pinned). */
export function formatDay(iso: string, language = "en"): string {
  return new Date(iso).toLocaleDateString(legacyLocaleFor(language), {
    day: "numeric",
    month: "long",
  });
}

/** @deprecated Use formatDateShort() from lib/format.ts (IST-pinned). */
export function formatShortDay(iso: string, language = "en"): string {
  return new Date(iso).toLocaleDateString(legacyLocaleFor(language), {
    day: "numeric",
    month: "short",
  });
}

/** @deprecated Use formatMoney() from lib/format.ts, which renders unknown as
 *  a marker instead of coercing null to ₹0. */
export function formatRupees(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}
