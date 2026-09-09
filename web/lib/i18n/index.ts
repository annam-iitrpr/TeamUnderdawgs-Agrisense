/**
 * Static, key-based UI translation.
 *
 * Two deliberate constraints from the build spec:
 *
 *  - Menus and labels are never generated at runtime by a language model. They
 *    are compiled dictionaries. Gemini may phrase server-supplied facts, but it
 *    does not invent navigation.
 *  - Untranslated keys are tracked and fail a completeness check rather than
 *    silently rendering English to a farmer who chose Telugu.
 *
 * Non-English dictionaries are `Partial`, so an untranslated key falls back to
 * English (readable, if wrong-language) and is reported by `missingKeys()`.
 * Typing them as complete `Dict`s would force fabricated translations to
 * satisfy the compiler, which is worse: it hides the gap instead of naming it.
 */
import { en, type Dict, type TranslationKey } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";
import { pa } from "./pa";
import { te } from "./te";

export type { Dict, TranslationKey };
export type Language = "en" | "hi" | "mr" | "pa" | "te";

export const LANGUAGES: ReadonlyArray<{ code: Language; native: string; english: string }> = [
  { code: "en", native: "English", english: "English" },
  { code: "hi", native: "हिंदी", english: "Hindi" },
  { code: "mr", native: "मराठी", english: "Marathi" },
  { code: "pa", native: "ਪੰਜਾਬੀ", english: "Punjabi" },
  { code: "te", native: "తెలుగు", english: "Telugu" },
];

export const DEFAULT_LANGUAGE: Language = "en";

export const dictionaries: Record<Language, Partial<Dict>> = { en, hi, mr, pa, te };

/**
 * Human review state per language.
 *
 * `reviewed` means a native speaker with agronomic context has signed off on
 * the agricultural terminology. Nothing is `reviewed` yet, and the UI surfaces
 * that rather than implying five polished locales. Do not flip a value here
 * without a named reviewer recorded in workstreams/phase-1/decisions.md.
 */
export const REVIEW_STATUS: Record<Language, "source" | "pending-review" | "reviewed"> = {
  en: "source",
  hi: "pending-review",
  mr: "pending-review",
  pa: "pending-review",
  te: "pending-review",
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}

/** Look up a key, falling back to English when a translation is absent. */
export function translate(language: Language, key: TranslationKey): string {
  return dictionaries[language]?.[key] ?? en[key];
}

/** Keys absent from a language's dictionary. Empty means complete. */
export function missingKeys(language: Language): TranslationKey[] {
  const dict = dictionaries[language] ?? {};
  return (Object.keys(en) as TranslationKey[]).filter((key) => {
    const value = dict[key];
    return typeof value !== "string" || value.trim() === "";
  });
}

/** Fraction of keys translated, 0 to 1. English is 1 by definition. */
export function completeness(language: Language): number {
  const total = Object.keys(en).length;
  if (total === 0) return 1;
  return (total - missingKeys(language).length) / total;
}

/** Every language with at least one untranslated key. */
export function incompleteLanguages(): Array<{ language: Language; missing: TranslationKey[] }> {
  return LANGUAGES.map((l) => ({ language: l.code, missing: missingKeys(l.code) })).filter(
    (entry) => entry.missing.length > 0,
  );
}

/**
 * Interpolate named placeholders, e.g. "{days} days" with { days: 3 }.
 *
 * An unmatched placeholder is left in place rather than replaced with
 * "undefined", so a missing value is visible in review instead of shipping a
 * sentence that reads as though a number were genuinely absent.
 */
export function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}
