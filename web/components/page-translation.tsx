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

  // Load the widget once. It reads the cookie as it initialises, so the cookie
  // is set before the script is appended.
  useEffect(() => {
    if (document.getElementById(SCRIPT_ID)) return;
    setTranslateCookie(GOOGLE_CODE[language] ?? "en");
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
    // Deliberately runs once: `language` is read for the initial cookie only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A later change drives the widget's own control rather than reloading.
  //
  // Reloading to re-read the cookie is the documented trick and it is a trap:
  // it needs somewhere to remember that the reload already happened, and when
  // that store is unavailable -- a private window, blocked site data -- the
  // condition never clears and the page reloads forever. A demo that reload
  // loops is worse than one that is not translated, so nothing here reloads.
  useEffect(() => {
    const target = GOOGLE_CODE[language] ?? "en";
    setTranslateCookie(target);
    let attempts = 0;
    const apply = () => {
      const combo = document.querySelector<HTMLSelectElement>("select.goog-te-combo");
      if (!combo) {
        // The widget loads asynchronously and may not be ready yet. Give it a
        // bounded number of tries rather than polling for the life of the page.
        if (++attempts < 20) window.setTimeout(apply, 300);
        return;
      }
      if (combo.value === target) return;
      combo.value = target;
      combo.dispatchEvent(new Event("change"));
    };
    apply();
  }, [language]);

  return <div id="agrisense-gtranslate-host" className="sr-only" aria-hidden />;
}
