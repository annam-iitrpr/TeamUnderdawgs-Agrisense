import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Map a 0 to 9 stress value onto the five step ramp. */
export function stressToken(value: number | null | undefined): string {
  if (value === null || value === undefined) return "var(--mist)";
  if (value < 2) return "var(--stress-none)";
  if (value < 4) return "var(--stress-low)";
  if (value < 6) return "var(--stress-moderate)";
  if (value < 7.5) return "var(--stress-high)";
  return "var(--stress-severe)";
}

/** The word that goes with the colour, so colour is never the only carrier. */
export function stressWord(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not applicable";
  if (value < 2) return "None";
  if (value < 4) return "Low";
  if (value < 6) return "Moderate";
  if (value < 7.5) return "High";
  return "Severe";
}

/** Maps an app language onto a BCP 47 locale for Intl. */
function localeFor(language = "en"): string {
  return { en: "en-IN", hi: "hi-IN", mr: "mr-IN" }[language] ?? "en-IN";
}

export function formatHour(iso: string): string {
  // Times stay in 24 hour digits in every language, which is what a farmer reads
  // off a phone clock.
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDay(iso: string, language = "en"): string {
  return new Date(iso).toLocaleDateString(localeFor(language), {
    day: "numeric",
    month: "long",
  });
}

export function formatShortDay(iso: string, language = "en"): string {
  return new Date(iso).toLocaleDateString(localeFor(language), {
    day: "numeric",
    month: "short",
  });
}

export function formatRupees(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function titleCase(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
