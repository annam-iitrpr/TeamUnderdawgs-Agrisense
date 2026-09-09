"use client";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Download, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useInstallPrompt, useServiceWorker } from "./use-service-worker";

/** Registers the service worker. Renders nothing. */
export function ServiceWorkerRegistrar() {
  useServiceWorker();
  return null;
}

/**
 * Install button.
 *
 * Rendered only when the browser has actually offered installation, so there is
 * never a dead "Install" control on Firefox or iOS Safari — the spec counts a
 * dead primary button as not finished.
 */
export function InstallAppButton({ className, label = "Install app" }: { className?: string; label?: string }) {
  const { state, install } = useInstallPrompt();
  if (state !== "available") return null;
  return (
    <Button variant="secondary" className={className} onClick={() => void install()}>
      <Download aria-hidden className="size-4" />
      {label}
    </Button>
  );
}

/**
 * Offline banner.
 *
 * `navigator.onLine` only proves a link exists, not that the API is reachable,
 * so this is framed as "you appear to be offline" and never as a claim that
 * the service is down.
 */
export function OfflineBanner({ message }: { message: string }) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold",
        "bg-[color-mix(in_srgb,var(--amber)_18%,var(--card))] text-amber-ink",
      )}
    >
      <WifiOff aria-hidden className="size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
