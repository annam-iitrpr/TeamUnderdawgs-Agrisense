"use client";

/**
 * Machine translation for the screens the dictionary has not reached yet.
 *
 * AgriSense has its own dictionary, and where a string goes through `t()` the
 * wording is reviewed and stays reviewed. Most components do not use it yet, so
 * choosing Hindi translated the shell and left the body of every page in
 * English -- a half-translated screen, which is harder to read than either
 * language on its own.
 *
 * This fills that gap rather than replacing the dictionary: reviewed strings
 * are already translated before this ever sees them, and this only reaches what
 * is still English. As the dictionary grows, this does less.
 *
 * It is deliberately a visible, dismissable overlay from a named provider and
 * not a silent rewrite, because machine translation of agronomy is not reliable
 * enough to pass off as our own words. Product names, doses and units are
 * marked `notranslate` at the point they are rendered wherever they carry an
 * instruction a farmer could act on.
 */
import { useLanguage } from "@/components/language-provider";
import { useEffect } from "react";

/** Google's own codes for the languages the switcher offers. */
const GOOGLE_CODE: Record<string, string> = {
  en: "en",
  hi: "hi",
  mr: "mr",
  pa: "pa",
  te: "te",
};

const SCRIPT_ID = "agrisense-gtranslate";

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: { translate?: { TranslateElement?: new (options: object, id: string) => void } };
  }
}

/** The widget reads its target from this cookie, on the bare host and the dot form. */
function setTranslateCookie(target: string): void {
  const value = target === "en" ? "" : `/en/${target}`;
  const host = window.location.hostname;
  const parts = host.split(".");
  const domains = [host, parts.length > 2 ? `.${parts.slice(-2).join(".")}` : `.${host}`];
  for (const domain of new Set(domains)) {
    // An empty value with an expiry in the past clears it, which is what
    // returning to English means: no translation layer at all.
    document.cookie = value
      ? `googtrans=${value};path=/;domain=${domain}`
      : `googtrans=;path=/;domain=${domain};expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    document.cookie = value
      ? `googtrans=${value};path=/`
      : `googtrans=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

export function PageTranslation() {
  const { language } = useLanguage();

  useEffect(() => {
    const target = GOOGLE_CODE[language] ?? "en";
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem("agrisense.gtrans");
    } catch {
      // Private mode. The cookie below still works for this page load.
    }
    if (stored === target) return;

    setTranslateCookie(target);
    try {
      window.sessionStorage.setItem("agrisense.gtrans", target);
    } catch {
      // Nothing to remember; the reload below still applies the cookie.
    }

    // The widget only reads the cookie as it initialises, so a change after
    // load needs the page to come back. Skipped on the first paint in English,
    // which is the common case and must not cost a farmer a reload.
    if (stored !== null || target !== "en") {
      window.location.reload();
      return;
    }
  }, [language]);

  useEffect(() => {
    if (document.getElementById(SCRIPT_ID)) return;
    window.googleTranslateElementInit = () => {
      const Element = window.google?.translate?.TranslateElement;
      if (!Element) return;
      new Element({ pageLanguage: "en", autoDisplay: false }, "agrisense-gtranslate-host");
    };
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    // A translation layer is a nicety; it must never block the app rendering.
    script.async = true;
    document.body.appendChild(script);
  }, []);

  return <div id="agrisense-gtranslate-host" className="sr-only" aria-hidden />;
}
