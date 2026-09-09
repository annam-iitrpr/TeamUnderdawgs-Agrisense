"use client";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher, useLanguage } from "@/components/language-provider";
import { Button, Callout, Card, Skeleton } from "@/components/ui";
import { AuthError, useAuth } from "@/features/auth/auth-provider";
import { InstallAppButton } from "@/features/pwa/pwa-controls";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function HomePage() {
  const { t, reviewPending } = useLanguage();
  const { status, user, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status === "initialising" || status === "signed-out") {
    return (
      <AppShell>
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-28 w-full rounded-card" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-40 w-full rounded-card" />
            <Skeleton className="h-40 w-full rounded-card" />
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
    <AppShell
      title={t("navHome")}
      headerActions={
        <>
          <InstallAppButton className="hidden sm:inline-flex" />
          <LanguageSwitcher className="hidden lg:flex" />
        </>
      }
    >
      <div className="space-y-4">
        {user && !user.emailVerified ? <VerificationBanner /> : null}

        {reviewPending ? (
          <Callout tone="caution" className="text-xs">
            This language is machine-translated and awaiting review by a native speaker. Wording
            may be wrong; the English version is the reviewed source.
          </Callout>
        ) : null}

        {/* Two columns from md, so a wide screen gains a column instead of
            stretching one paragraph across the whole monitor. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h2 className="text-h3 font-semibold">Signed in</h2>
            <p className="mt-1.5 break-all text-sm text-slate">{user?.email ?? ""}</p>
            <p className="mt-2 text-sm text-slate">
              Authentication works end to end against the team&apos;s Firebase project: account
              creation, sign-in, session persistence across a reload, and sign-out.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void signOut()}>
                {t("signOutAction")}
              </Button>
              <InstallAppButton className="sm:hidden" />
            </div>
          </Card>

          {/* Deliberately not a dashboard of placeholder numbers: the spec
              treats fake KPI values and dead buttons as not-done. */}
          <Card className="p-4">
            <h2 className="text-h3 font-semibold">Not built yet</h2>
            <p className="mt-1.5 text-sm text-slate">
              These farmer workflows are next. No placeholder figures stand in for them.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-slate">
              {[
                "Onboarding and field setup (P1-02)",
                "Crop comparison and warnings (P1-03)",
                "Field dashboard and switching (P1-04)",
                "Readiness, forecast and spray window (P1-05)",
                "Live ROI and water plan (P1-06)",
                "Season Journal (P1-07)",
                "Ask assistant (P1-08)",
                "Reminders and seven-day plan (P1-09)",
                "End of season review (P1-10)",
                "Agronomist dashboard (P1-11)",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-mist" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function VerificationBanner() {
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
    <Callout tone="caution" title={t("verifyEmailTitle")}>
      <p>{t("verifyEmailBody")}</p>
      {state === "sent" ? (
        <p className="mt-2 font-semibold text-forest">{t("done")}</p>
      ) : (
        <Button
          variant="ghost"
          className="mt-2 px-0"
          busy={state === "sending"}
          onClick={() => void resend()}
        >
          {t("verifyEmailResend")}
        </Button>
      )}
      {message ? <p className="mt-1.5 text-clay">{message}</p> : null}
    </Callout>
  );
}
