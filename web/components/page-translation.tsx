"use client";

/**
 * NOT MOUNTED. Machine page translation is incompatible with React here.
 *
 * This worked -- the whole page really did render in Hindi -- and it crashed the
 * app. The provider rewrites text nodes in place, wrapping them in its own
 * elements, and React then tries to update or remove nodes that are no longer
 * where its tree says they are. The result is
 *
 *   NotFoundError: Failed to execute 'removeChild' on 'Node':
 *   The node to be removed is not a child of this node
 *
 * thrown from React's commit phase, which unmounts everything and leaves the
 * farmer on "Application error: a client-side exception has occurred". It fired
 * the moment a search rendered its results, and it would fire on any re-render
 * over translated text: a list appearing, a figure refreshing, a panel opening.
 *
 * There is no safe way to scope around it. Every subtree React re-renders would
 * have to be marked `translate="no"`, which is most of the app, and a single
 * missed one crashes the whole page rather than mistranslating a word.
 *
 * The real fix is the dictionary in `lib/locale/`, which already carries five
 * languages and cannot break React because the strings are chosen before render.
 * Extending its coverage is the work; this file is kept only so the next person
 * to reach for a translate widget finds out why it was taken out.
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
