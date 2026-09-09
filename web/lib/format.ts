/**
 * The single place where a timestamp, an area or a money value becomes text.
 *
 * Three rules this module exists to enforce:
 *
 *  1. The API sends UTC instants. Farmers read them in IST. Formatting a UTC
 *     instant with the wrong timezone silently shifts the calendar date by a
 *     day for anything before 05:30 IST, which would move a spray window onto
 *     the wrong morning. Every function here pins Asia/Kolkata explicitly.
 *  2. Unknown is not zero. A null value formats as an explicit unknown string,
 *     never as "0" or "₹0".
 *  3. A relative word ("tomorrow") is never shown alone — it is always paired
 *     with the actual calendar date.
 */

export const APP_TIMEZONE = "Asia/Kolkata";

/** Languages the farmer UI ships. Kept here so formatters and i18n agree. */
export type Language = "en" | "hi" | "mr" | "pa" | "te";

const LOCALES: Record<Language, string> = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
  pa: "pa-IN",
  te: "te-IN",
};

export function localeFor(language: Language = "en"): string {
  return LOCALES[language] ?? "en-IN";
}

/* ─────────────────────────────────────────────────────────── date and time */

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The calendar date in IST for a UTC instant, as `YYYY-MM-DD`.
 *
 * Used as a grouping key (seven-day plan, journal timeline). Deriving this with
 * `toISOString().slice(0, 10)` would be the UTC date, which is the bug this
 * function exists to prevent.
 */
export function istDateKey(iso: string): string | null {
  const d = parse(iso);
  if (!d) return null;
  // en-CA renders as YYYY-MM-DD, which sorts correctly as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Clock time, 24-hour, in IST. Digits stay Latin in every language: this is
 *  what a farmer reads off a phone clock. */
export function formatTime(iso: string, unknown = "—"): string {
  const d = parse(iso);
  if (!d) return unknown;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Day and month, localised. e.g. "25 July". */
export function formatDate(iso: string, language: Language = "en", unknown = "—"): string {
  const d = parse(iso);
  if (!d) return unknown;
  return new Intl.DateTimeFormat(localeFor(language), {
    timeZone: APP_TIMEZONE,
    day: "numeric",
    month: "long",
  }).format(d);
}

/** Short form for dense rows and chart axes. e.g. "25 Jul". */
export function formatDateShort(iso: string, language: Language = "en", unknown = "—"): string {
  const d = parse(iso);
  if (!d) return unknown;
  return new Intl.DateTimeFormat(localeFor(language), {
    timeZone: APP_TIMEZONE,
    day: "numeric",
    month: "short",
  }).format(d);
}

/** Weekday plus date, for the seven-day plan headers. e.g. "Friday, 25 July". */
export function formatDateWithWeekday(
  iso: string,
  language: Language = "en",
  unknown = "—",
): string {
  const d = parse(iso);
  if (!d) return unknown;
  return new Intl.DateTimeFormat(localeFor(language), {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

/**
 * Whole days from today to the target, both taken as IST calendar dates.
 *
 * Counted in calendar days rather than 24-hour blocks, so an event at 23:00
 * tonight is 0 ("today") and an event at 01:00 tomorrow is 1 ("tomorrow"),
 * which is how a person would describe them.
 */
export function daysFromToday(iso: string, now: Date = new Date()): number | null {
  const target = istDateKey(iso);
  const today = istDateKey(now.toISOString());
  if (!target || !today) return null;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${target}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * A spray interval as one readable string: `[start, end)`.
 *
 * The end instant is exclusive. It is rendered as a plain end time because
 * "06:00 to 08:00" is what a farmer acts on, but callers doing arithmetic must
 * treat it as exclusive.
 */
export function formatInterval(
  startIso: string,
  endIso: string,
  language: Language = "en",
  joiner = "to",
  unknown = "—",
): string {
  const start = parse(startIso);
  const end = parse(endIso);
  if (!start || !end) return unknown;

  const sameDay = istDateKey(startIso) === istDateKey(endIso);
  const date = formatDate(startIso, language);
  if (sameDay) {
    return `${date}, ${formatTime(startIso)} ${joiner} ${formatTime(endIso)}`;
  }
  return `${date} ${formatTime(startIso)} ${joiner} ${formatDate(endIso, language)} ${formatTime(endIso)}`;
}

/* ───────────────────────────────────────────────────────────────── area */

export type AreaUnit = "ha" | "acre";

const HECTARES_PER_ACRE = 0.404_685_642_2;

export function acresToHectares(acres: number): number {
  return acres * HECTARES_PER_ACRE;
}

export function hectaresToAcres(hectares: number): number {
  return hectares / HECTARES_PER_ACRE;
}

/**
 * Area with its unit always visible.
 *
 * Onboarding echoes the normalised value back to the farmer so a unit slip
 * (2 hectares entered when 2 acres was meant) is visible immediately rather
 * than silently scaling every litre and rupee for the rest of the season.
 */
export function formatArea(
  value: number | null | undefined,
  unit: AreaUnit,
  language: Language = "en",
  unknown = "—",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return unknown;
  const digits = value < 10 ? 2 : 1;
  const formatted = new Intl.NumberFormat(localeFor(language), {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
  return unit === "ha" ? `${formatted} ha` : `${formatted} acre`;
}

/* ───────────────────────────────────────────────────────────────── money */

/**
 * Rupees. Negative is rendered as negative: a loss-making season is a valid
 * outcome and must never be clamped to a positive green number.
 */
export function formatMoney(
  value: number | null | undefined,
  language: Language = "en",
  unknown = "—",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return unknown;
  return new Intl.NumberFormat(localeFor(language), {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** A p10–p90 band. Collapses to a single figure when the bounds are equal. */
export function formatMoneyRange(
  low: number | null | undefined,
  high: number | null | undefined,
  language: Language = "en",
  joiner = "to",
  unknown = "—",
): string {
  const hasLow = low !== null && low !== undefined && Number.isFinite(low);
  const hasHigh = high !== null && high !== undefined && Number.isFinite(high);
  if (!hasLow && !hasHigh) return unknown;
  if (hasLow && !hasHigh) return formatMoney(low, language, unknown);
  if (!hasLow && hasHigh) return formatMoney(high, language, unknown);
  if (low === high) return formatMoney(low, language, unknown);
  return `${formatMoney(low, language, unknown)} ${joiner} ${formatMoney(high, language, unknown)}`;
}

/* ─────────────────────────────────────────────────────────────── numbers */

/** Plain localised number with an explicit unit suffix. */
export function formatQuantity(
  value: number | null | undefined,
  unit: string,
  language: Language = "en",
  maximumFractionDigits = 1,
  unknown = "—",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return unknown;
  const formatted = new Intl.NumberFormat(localeFor(language), {
    maximumFractionDigits,
  }).format(value);
  return `${formatted} ${unit}`;
}

/**
 * Litres, abbreviated once the figure stops being readable digit by digit.
 * Irrigation volumes reach millions, and "1,240,000 L" is harder to read than
 * "12.4 lakh L" for the audience this is built for.
 */
export function formatLitres(
  value: number | null | undefined,
  language: Language = "en",
  unknown = "—",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return unknown;
  const nf = (v: number, d = 1) =>
    new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: d }).format(v);
  if (Math.abs(value) >= 10_000_000) return `${nf(value / 10_000_000)} crore L`;
  if (Math.abs(value) >= 100_000) return `${nf(value / 100_000)} lakh L`;
  return `${nf(value, 0)} L`;
}

/**
 * A percentage, or the unknown string when the denominator made it undefined.
 * ROI with a zero or missing cost basis is null, not 0%.
 */
export function formatPercent(
  value: number | null | undefined,
  language: Language = "en",
  maximumFractionDigits = 0,
  unknown = "—",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return unknown;
  return `${new Intl.NumberFormat(localeFor(language), { maximumFractionDigits }).format(value)}%`;
}
