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
