"use client";

/**
 * Service worker registration and install-prompt handling.
 *
 * Registration is deliberately gated on production. A worker intercepting
 * navigations during development makes hot reload behave unpredictably and
 * hides real network failures, which is the opposite of what a dev build should
 * do.
 */
import { useCallback, useEffect, useState } from "react";

const SW_URL = "/sw.js";

export type InstallState = "unsupported" | "unavailable" | "available" | "installed";

/**
 * The `beforeinstallprompt` event, which is not in the standard DOM types
 * because it is Chromium-specific.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function useServiceWorker(): { ready: boolean; purge: () => void } {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let cancelled = false;
    navigator.serviceWorker
      .register(SW_URL)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // A failed registration must never break the app; it just means no
        // offline fallback and no install prompt.
        if (!cancelled) setReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Ask the worker to drop every cache it owns. Called on sign-out. */
  const purge = useCallback(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.controller?.postMessage({ type: "AGRISENSE_PURGE_CACHES" });
  }, []);

  return { ready, purge };
}

/**
 * Tracks whether the app can be installed, and installs it on request.
 *
 * The browser only fires `beforeinstallprompt` when its own criteria are met
 * (valid manifest, service worker, engagement heuristics), so "available" here
 * reflects the browser's judgement rather than our guess. `prompt()` may only
 * be called from a user gesture.
 */
export function useInstallPrompt(): {
  state: InstallState;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
} {
  const [state, setState] = useState<InstallState>("unavailable");
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already running as an installed app.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari exposes this instead of display-mode.
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      setState("installed");
      return;
    }

    if (!("onbeforeinstallprompt" in window)) {
      // Firefox and iOS Safari never fire it. The UI must not show a dead
      // "Install" button there.
      setState("unsupported");
      return;
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
      setState("available");
    };
    const onInstalled = () => {
      setState("installed");
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use.
    setDeferred(null);
    setState(outcome === "accepted" ? "installed" : "unavailable");
    return outcome;
  }, [deferred]);

  return { state, install };
}
