"use client";

import { LanguageSwitcher, useLanguage } from "@/components/language-provider";
import { Callout } from "@/components/ui";
import { useAuth } from "./auth-provider";
import type { ReactNode } from "react";

/**
 * Frame shared by sign-in, sign-up and password reset.
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
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-[27rem] flex-col px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-h2 font-semibold text-forest">{t("appName")}</p>
          <p className="text-xs text-slate">{t("tagline")}</p>
        </div>
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
    </main>
  );
}
