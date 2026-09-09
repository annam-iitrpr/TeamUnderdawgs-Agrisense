"use client";

import { LanguageSwitcher, useLanguage } from "@/components/language-provider";
import { Button, Callout, Card, Skeleton } from "@/components/ui";
import { AuthError, useAuth } from "@/features/auth/auth-provider";
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
      <main id="main" className="mx-auto w-full max-w-[27rem] space-y-4 px-4 py-6" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-28 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </main>
    );
  }

  if (status === "misconfigured") {
    return (
      <main id="main" className="mx-auto w-full max-w-[27rem] px-4 py-6">
        <Callout tone="blocked" title="Sign-in is not configured">
          Authentication cannot start. Open <span className="font-mono text-xs">/sign-in</span> to
          see which environment variables are missing.
        </Callout>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[27rem] px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-h2 font-semibold text-forest">{t("appName")}</p>
          <p className="truncate text-xs text-slate">{user?.email ?? ""}</p>
        </div>
        <LanguageSwitcher />
      </div>

      {user && !user.emailVerified ? <VerificationBanner /> : null}

      {reviewPending ? (
        // Honesty label: this language's agricultural wording has not been
        // reviewed by a native speaker or agronomist yet.
        <Callout tone="caution" className="mt-4 text-xs">
          This language is machine-translated and awaiting review by a native speaker. Wording may
          be wrong; the English version is the reviewed source.
        </Callout>
      ) : null}

      <Card className="mt-5 p-4">
        <h1 className="text-h3 font-semibold">Signed in</h1>
        <p className="mt-1.5 text-sm text-slate">
          Authentication (P1-01) works end to end: account creation, sign-in, session persistence
          across refresh, and sign-out.
        </p>
        <Button variant="secondary" className="mt-4 w-full" onClick={() => void signOut()}>
          {t("signOutAction")}
        </Button>
      </Card>

      {/* Deliberately not a dashboard of placeholder numbers. The spec is
          explicit that fake KPI values and dead buttons do not count as
          finished, so what is not built is simply named. */}
      <Card className="mt-4 p-4">
        <h2 className="text-h3 font-semibold">Not built yet</h2>
        <p className="mt-1.5 text-sm text-slate">
          The farmer workflows below need the backend contract that Phase 3 has not published yet.
          No placeholder figures are shown in their place.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-slate">
          {[
            "Onboarding and field setup (P1-02)",
            "Crop comparison and warnings (P1-03)",
            "Home dashboard and field switching (P1-04)",
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
    </main>
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
    <Callout tone="caution" title={t("verifyEmailTitle")} className="mt-4">
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
