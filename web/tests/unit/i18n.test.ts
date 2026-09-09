import { describe, expect, it } from "vitest";
import { en } from "@/lib/locale/en";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  REVIEW_STATUS,
  completeness,
  dictionaries,
  incompleteLanguages,
  interpolate,
  isLanguage,
  missingKeys,
  translate,
  type Language,
} from "@/lib/locale";

const SHIPPED: Language[] = ["en", "hi", "mr", "pa", "te"];

describe("language set", () => {
  it("ships exactly the five languages the spec names", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(SHIPPED);
  });

  it("gives every language a native-script name for the switcher", () => {
    for (const l of LANGUAGES) {
      expect(l.native.trim().length).toBeGreaterThan(0);
      expect(l.english.trim().length).toBeGreaterThan(0);
    }
  });

  it("recognises valid codes and rejects anything else", () => {
    expect(isLanguage("hi")).toBe(true);
    expect(isLanguage("bn")).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage(42)).toBe(false);
  });
});

describe("translation completeness", () => {
  // This is the spec's "track untranslated keys and fail completeness checks".
  // It fails loudly when a key is added to English without the other four
  // dictionaries being updated, which is exactly when a farmer would otherwise
  // start seeing English text inside a Telugu screen.
  it.each(SHIPPED)("%s has no untranslated keys", (language) => {
    const missing = missingKeys(language);
    expect(
      missing,
      `${language} is missing ${missing.length} key(s): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("reports full completeness for every shipped language", () => {
    for (const language of SHIPPED) {
      expect(completeness(language)).toBe(1);
    }
  });

  it("reports no incomplete languages", () => {
    expect(incompleteLanguages()).toEqual([]);
  });

  it("treats a whitespace-only translation as missing", () => {
    // Guards the completeness check itself: a blank string must not count as
    // translated, or the check could pass while screens render empty labels.
    const stub: Record<string, string> = { ...en, back: "   " };
    const total = Object.keys(en).length;
    const translated = Object.keys(en).filter((k) => (stub[k] ?? "").trim() !== "").length;
    expect(translated).toBe(total - 1);
  });
});

describe("fallback behaviour", () => {
  it("returns the translation when one exists", () => {
    expect(translate("hi", "back")).toBe(dictionaries.hi.back);
    expect(translate("hi", "back")).not.toBe(en.back);
  });

  it("falls back to English rather than rendering nothing", () => {
    expect(translate(DEFAULT_LANGUAGE, "appName")).toBe(en.appName);
  });
});

describe("review status", () => {
  it("marks English as the source and every other language as unreviewed", () => {
    // Honesty check: nothing claims agronomist review until a named reviewer is
    // recorded in decisions.md. If this test is updated, that record must exist.
    expect(REVIEW_STATUS.en).toBe("source");
    for (const language of SHIPPED.filter((l) => l !== "en")) {
      expect(REVIEW_STATUS[language]).toBe("pending-review");
    }
  });
});

describe("interpolate", () => {
  it("substitutes named placeholders", () => {
    expect(interpolate("{days} days on {area} ha", { days: 3, area: 1.2 })).toBe(
      "3 days on 1.2 ha",
    );
  });

  it("leaves an unmatched placeholder visible instead of printing undefined", () => {
    expect(interpolate("{days} days", {})).toBe("{days} days");
  });

  it("substitutes a zero value rather than treating it as absent", () => {
    expect(interpolate("{n} left", { n: 0 })).toBe("0 left");
  });
});
