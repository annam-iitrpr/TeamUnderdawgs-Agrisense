"use client";

import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  REVIEW_STATUS,
  interpolate,
  isLanguage,
  translate,
  type Language,
  type TranslationKey,
} from "@/lib/locale";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "agrisense.language";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  /** Translate a key, optionally interpolating named placeholders. */
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  /** True while this language has no native-speaker/agronomist review. */
  reviewPending: boolean;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}

/**
 * Holds the active language and keeps `<html lang>` in sync.
 *
 * The lang attribute matters beyond correctness: without it a screen reader
 * announces Devanagari or Telugu text with an English voice, which is
 * unintelligible. It is set on restore as well as on change.
 *
 * Rendering starts at the default language on both server and client so the
 * markup matches, then the stored preference is applied in an effect. Reading
 * localStorage during render would hydrate-mismatch.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode or blocked site data. The default language still works.
    }
    if (isLanguage(stored)) {
      setLanguageState(stored);
      document.documentElement.lang = stored;
    } else {
      document.documentElement.lang = DEFAULT_LANGUAGE;
    }
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply does not persist; not worth failing the interaction.
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, values) => {
        const text = translate(language, key);
        return values ? interpolate(text, values) : text;
      },
      reviewPending: REVIEW_STATUS[language] === "pending-review",
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Language switcher. Shows every language in its own script, because a farmer
 * looking for Punjabi is looking for "ਪੰਜਾਬੀ", not for the word "Punjabi".
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage, t } = useLanguage();
  return (
    // min-w-0 is what lets the scrollable pill inside actually shrink: without it
    // this flex item keeps its full content width and pushes the page sideways.
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <Globe aria-hidden className="size-4 shrink-0 text-slate" />
      <span className="sr-only" id="language-label">
        {t("changeLanguage")}
      </span>
      <div
        role="group"
        aria-labelledby="language-label"
        // Never machine-translated. Each language is already written in its own
        // script, and translating them defeats the control: a farmer who lands
        // in a language they cannot read needs to find "English" still saying
        // English to get back out of it.
        translate="no"
        // Never wraps: a rounded pill that breaks onto two rows loses its shape and
        // the row stops reading as one control. Five scripts of differing width do not
        // fit a narrow phone header, so it scrolls sideways there instead.
        className="flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-full border border-mist bg-card p-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {LANGUAGES.map((option) => (
          <button
            key={option.code}
            type="button"
            onClick={() => setLanguage(option.code)}
            aria-pressed={language === option.code}
            lang={option.code}
            className={cn(
              "min-h-[36px] shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors duration-[120ms]",
              language === option.code ? "bg-forest text-white" : "text-slate hover:text-ink",
            )}
          >
            {option.native}
          </button>
        ))}
      </div>
    </div>
  );
}
