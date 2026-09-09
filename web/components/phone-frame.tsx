"use client";

import { DataModeBadge, LanguageSwitcher, useApp } from "@/components/providers";
import { cn } from "@/lib/utils";
import { ChevronLeft, Sprout } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The farmer surface. Rendered at 390px inside a phone frame on desktop, with an
 * honest caption about what the WhatsApp integration will replace.
 *
 * On a real phone the frame collapses to full bleed, so the same code serves both.
 */
export function PhoneFrame({
  children,
  title,
  backHref,
  footer,
}: {
  children: ReactNode;
  title?: string;
  backHref?: string;
  footer?: ReactNode;
}) {
  const { t } = useApp();

  return (
    <div className="min-h-dvh bg-paper">
      {/* Desktop chrome around the phone. Hidden on real phones. */}
      <div className="mx-auto flex max-w-[64rem] flex-col items-center px-4 py-0 sm:py-10">
        <div className="mb-5 hidden w-full items-center justify-between sm:flex">
          <Link href="/" className="flex items-center gap-2">
            <Sprout aria-hidden className="size-5 text-forest" />
            <span className="text-h3 font-semibold tracking-tight">AgriSense</span>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <DataModeBadge />
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-navy underline decoration-[color-mix(in_srgb,var(--navy)_40%,transparent)]"
            >
              Agronomist view
            </Link>
          </div>
        </div>

        <div
          className={cn(
            "w-full sm:w-[390px] sm:shrink-0",
            "sm:overflow-hidden sm:rounded-[2rem] sm:border-[10px] sm:border-ink sm:shadow-soft",
          )}
        >
          <div className="flex min-h-dvh flex-col bg-card sm:min-h-[780px]">
            <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-mist bg-card/95 px-4 py-3 backdrop-blur-sm">
              {backHref ? (
                <Link
                  href={backHref}
                  aria-label={t("back")}
                  className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink"
                >
                  <ChevronLeft aria-hidden className="size-6" />
                </Link>
              ) : (
                <Sprout aria-hidden className="size-6 shrink-0 text-forest" />
              )}
              <h1 className="text-h3 font-semibold tracking-tight">
                {title ?? t("appName")}
              </h1>
              <div className="ml-auto sm:hidden">
                <DataModeBadge />
              </div>
            </header>

            <main id="main" className="flex-1 overflow-y-auto">
              {children}
            </main>

            {footer ? (
              <div className="sticky bottom-0 border-t border-mist bg-card px-4 py-3">
                {footer}
              </div>
            ) : null}
          </div>
        </div>

        <p className="mt-4 hidden max-w-[42ch] text-center text-xs text-slate sm:block">
          WhatsApp integration lands in the Build Sprint. This is the same
          conversation flow, running against the live scoring engine.
        </p>

        <div className="mt-4 flex w-full justify-center sm:hidden">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
