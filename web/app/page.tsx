"use client";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import { Button, Callout, Skeleton } from "@/components/ui";
import { AuthError, useAuth } from "@/features/auth/auth-provider";
import { FieldDashboard } from "@/features/fields/field-dashboard";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function HomePage() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status === "initialising" || status === "signed-out") {
    return (
      <AppShell>
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-card" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-48 w-full rounded-card lg:col-span-2" />
            <Skeleton className="h-48 w-full rounded-card" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (status === "misconfigured") {
    return (
      <AppShell>
        <Callout tone="blocked" title="Sign-in is not configured">
          Authentication cannot start. Open <span className="font-mono text-xs">/sign-in</span> to
          see which environment variables are missing.
        </Callout>
      </AppShell>
    );
  }

  return (
    <>
      {user && !user.emailVerified ? <VerificationNotice /> : null}
      <FieldDashboard />
    </>
  );
}

/**
 * Email verification prompt.
 *
 * Rendered above the dashboard rather than blocking it: an unverified account
 * can still read its own fields, and locking a farmer out of their data over an
 * unopened email would be worse than the risk it mitigates.
 */
function VerificationNotice() {
  const { t } = useLanguage();
  const { resendVerification } = useAuth();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function resend() {
    setState("sending");
    setMessage(null);
    try {
      await resendVerification();
      setState("sent");
    } catch (error) {
      setState("failed");
      setMessage(error instanceof AuthError ? t(error.key) : t("errorTitle"));
    }
  }

  return (
    <div className="border-b border-amber/40 bg-[color-mix(in_srgb,var(--amber)_12%,var(--card))] px-4 py-2.5">
      <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-amber-ink">{t("verifyEmailTitle")}</span>
        <span className="text-slate">{t("verifyEmailBody")}</span>
        {state === "sent" ? (
          <span className="font-semibold text-forest">{t("done")}</span>
        ) : (
          <Button variant="ghost" className="px-0" busy={state === "sending"} onClick={() => void resend()}>
            {t("verifyEmailResend")}
          </Button>
        )}
        {message ? <span className="text-clay">{message}</span> : null}
      </div>
    </div>
  );
}
