"use client";

import { LanguageSwitcher, useLanguage } from "@/components/language-provider";
import { Callout } from "@/components/ui";
import { useAuth } from "./auth-provider";
import type { ReactNode } from "react";

/**
 * Frame shared by phone sign-in and account creation.
 *
 * Keeps the language switcher on the unauthenticated screens: a farmer who
 * cannot read English needs to change language *before* being asked to type
 * credentials, not after.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useLanguage();
  const { status, missingConfig, usingEmulator } = useAuth();

  return (
    // Full width on every screen. The form itself stays a comfortable reading
    // measure, but on a desktop that measure sits inside a real page rather than
    // a phone-width column with empty space either side of it.
    <main id="main" className="flex min-h-dvh w-full flex-col lg:flex-row">
      <aside className="hidden bg-forest px-10 py-12 text-white lg:flex lg:w-[42%] lg:max-w-[34rem] lg:flex-col lg:justify-between">
        <div>
          <p className="text-h2 font-semibold">{t("appName")}</p>
          <p className="mt-2 text-sm text-white/80">{t("tagline")}</p>
        </div>
        <p className="max-w-[26rem] text-sm leading-relaxed text-white/70">
          Your field records, water and spending stay yours. Advice is only shown when the
          evidence supports it, and every number says where it came from.
        </p>
      </aside>

      <div className="flex w-full flex-1 justify-center px-4 py-6 sm:px-6 lg:px-10 lg:py-12">
        <div className="flex w-full max-w-[28rem] flex-col">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <div>
          <p className="text-h2 font-semibold text-forest">{t("appName")}</p>
          <p className="text-xs text-slate">{t("tagline")}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-start lg:mt-0 lg:justify-end">
        <LanguageSwitcher />
      </div>

      {status === "misconfigured" ? (
        <Callout tone="blocked" title="Sign-in is not configured" className="mt-5">
          <p>
            These environment variables are missing, so authentication cannot start:{" "}
            <span className="font-mono text-xs">{missingConfig.join(", ")}</span>. Add them to
            an ignored <span className="font-mono text-xs">web/.env.local</span> and restart the
            dev server.
          </p>
        </Callout>
      ) : null}

      {usingEmulator ? (
        // Visible on purpose: it must be obvious that these accounts are local
        // test accounts and not real ones.
        <Callout tone="info" className="mt-5">
          Using the local Firebase Auth Emulator. Accounts created here are local test accounts.
        </Callout>
      ) : null}

      <div className="mt-6">
        <h1 className="text-h1 font-semibold text-ink">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm text-slate">{subtitle}</p> : null}
      </div>

      <div className="mt-5">{children}</div>

      {footer ? <div className="mt-6 text-sm text-slate">{footer}</div> : null}
        </div>
      </div>
    </main>
  );
}
