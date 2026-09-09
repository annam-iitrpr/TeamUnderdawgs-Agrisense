"use client";

import type { ConfigResponse } from "@/lib/api";
import { LANGUAGES, type Language, t as translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Check, Database, Globe, Wifi } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Ctx = {
  language: Language;
  setLanguage: (l: Language) => void;
  t: (key: Parameters<typeof translate>[1]) => string;
  config: ConfigResponse | null;
};

const AppContext = createContext<Ctx | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  const [config, setConfig] = useState<ConfigResponse | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("agrisense.language");
    if (saved && LANGUAGES.some((l) => l.code === saved)) {
      setLanguageState(saved as Language);
      // The lang attribute has to follow the restored language too, otherwise a
      // screen reader announces Hindi content with an English voice.
      document.documentElement.lang = saved;
    }
    // The pre-contract /api/config route does not exist in v1 and 404s on every page
    // load. Provenance now travels on each response's `meta` instead, so nothing is
    // requested here and the badge renders only if a caller supplies config directly.
  }, []);

  const setLanguage = useCallback((l: Language) => {
    setLanguageState(l);
    window.localStorage.setItem("agrisense.language", l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: Parameters<typeof translate>[1]) => translate(language, key),
    [language],
  );

  return (
    <AppContext.Provider value={{ language, setLanguage, t, config }}>
      {children}
    </AppContext.Provider>
  );
}

/* ------------------------------------------------------- Language switcher */

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage, t } = useApp();
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Globe aria-hidden className="size-4 text-slate" />
      <span className="sr-only" id="language-label">
        {t("language")}
      </span>
      <div
        role="group"
        aria-labelledby="language-label"
        className="flex rounded-full border border-mist bg-card p-0.5"
      >
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            onClick={() => setLanguage(l.code)}
            aria-pressed={language === l.code}
            className={cn(
              "min-h-[32px] rounded-full px-3 text-xs font-semibold transition-colors duration-[120ms]",
              language === l.code
                ? "bg-forest text-white"
                : "text-slate hover:text-ink",
            )}
          >
            {l.native}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Data mode badge */

/**
 * Shows whether the numbers on screen came from a live API or a bundled fixture.
 * Expands to name each source. Honesty about data source is a scoring criterion.
 */
export function DataModeBadge() {
  const { config, t } = useApp();
  const [open, setOpen] = useState(false);
  if (!config) return null;

  const label =
    config.badge === "live"
      ? t("dataLive")
      : config.badge === "demo"
        ? t("dataDemo")
        : t("dataMixed");

  const tone =
    config.badge === "live"
      ? "text-forest"
      : config.badge === "demo"
        ? "text-amber-ink"
        : "text-navy";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-mist bg-card px-3 text-xs font-semibold"
      >
        {config.badge === "demo" ? (
          <Database aria-hidden className={cn("size-3.5", tone)} />
        ) : (
          <Wifi aria-hidden className={cn("size-3.5", tone)} />
        )}
        <span className={tone}>{label}</span>
      </button>

      {open ? (
        <div className="animate-rise absolute right-0 z-50 mt-2 w-[19rem] rounded-card border border-mist bg-card p-3 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate">
            {t("whereDataComes")}
          </p>
          <ul className="mt-2 space-y-2">
            {Object.entries(config.sources).map(([key, source]) => (
              <li key={key} className="flex items-start gap-2 text-xs">
                <span
                  aria-hidden
                  className="mt-1 size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: source.live
                      ? "var(--sprout)"
                      : "var(--amber)",
                  }}
                />
                <span>
                  <span className="font-semibold capitalize">{key}</span>
                  <span className="text-slate">
                    {": "}
                    {source.live
                      ? source.primary
                      : `${source.substitute ?? "Bundled fixtures"}, no key configured`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 border-t border-mist pt-2 text-xs text-slate">
            Mode {config.data_mode}. Nothing here is hidden: a fixture is always
            labelled as a fixture.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- Reminder pill */

export function ReminderToggle({ label, doneLabel }: { label: string; doneLabel: string }) {
  const [set, setSet] = useState(false);
  return (
    <button
      onClick={() => setSet((v) => !v)}
      aria-pressed={set}
      className={cn(
        "inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-control border px-4 text-body font-semibold transition-colors duration-[120ms]",
        set
          ? "border-sprout bg-[color-mix(in_srgb,var(--sprout)_12%,transparent)] text-forest"
          : "border-mist bg-card text-ink",
      )}
    >
      {set ? <Check aria-hidden className="size-5" /> : null}
      {set ? doneLabel : label}
    </button>
  );
}
