"use client";

import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/locale";
import { Button, Callout, PasswordField, TextField } from "@/components/ui";
import { AuthError, useAuth } from "@/features/auth/auth-provider";
import { AuthShell } from "@/features/auth/auth-shell";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * Reads `?reason=expired`, which the session-expiry redirect sets.
 *
 * Isolated into its own component behind Suspense because useSearchParams()
 * opts a route out of static prerendering unless it sits inside a boundary —
 * without this the production build fails on /sign-in.
 */
function SessionExpiredNotice() {
  const { t } = useLanguage();
  const params = useSearchParams();
  if (params.get("reason") !== "expired") return null;
  return (
    <Callout tone="caution" title={t("sessionExpiredTitle")} className="mb-4">
      {t("sessionExpiredBody")}
    </Callout>
  );
}

export default function SignInPage() {
  const { t } = useLanguage();
  const { signIn, status } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Translation KEYS, not resolved strings. Storing the resolved text would
  // freeze it in whatever language was active at submit time, so switching
  // language afterwards left English errors under Telugu labels.
  const [emailErrorKey, setEmailErrorKey] = useState<TranslationKey | null>(null);
  const [passwordErrorKey, setPasswordErrorKey] = useState<TranslationKey | null>(null);
  const [formErrorKey, setFormErrorKey] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // A session that is already valid should not sit on the sign-in screen.
  useEffect(() => {
    if (status === "signed-in") router.replace("/");
  }, [status, router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormErrorKey(null);

    const nextEmailError: TranslationKey | null =
      email.trim() === "" ? "authRequiredEmail" : null;
    const nextPasswordError: TranslationKey | null =
      password === "" ? "authRequiredPassword" : null;
    setEmailErrorKey(nextEmailError);
    setPasswordErrorKey(nextPasswordError);

    // Focus moves to the first invalid input, per the spec's error handling.
    if (nextEmailError) {
      emailRef.current?.focus();
      return;
    }
    if (nextPasswordError) {
      passwordRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      await signIn(email, password);
      router.replace("/");
    } catch (error) {
      setFormErrorKey(error instanceof AuthError ? error.key : "errorTitle");
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t("signInTitle")}
      subtitle={t("signInSubtitle")}
      footer={
        <div className="space-y-2">
          <p>
            {t("noAccountPrompt")}{" "}
            <Link href="/sign-up" className="font-semibold text-forest underline">
              {t("signUpAction")}
            </Link>
          </p>
          <p>
            <Link href="/reset-password" className="font-semibold text-forest underline">
              {t("forgotPassword")}
            </Link>
          </p>
        </div>
      }
    >
      <Suspense fallback={null}>
        <SessionExpiredNotice />
      </Suspense>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextField
          ref={emailRef}
          label={t("emailLabel")}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailErrorKey ? t(emailErrorKey) : undefined}
          disabled={busy}
        />

        <PasswordField
          ref={passwordRef}
          label={t("passwordLabel")}
          autoComplete="current-password"
          showLabel={t("passwordShow")}
          hideLabel={t("passwordHide")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordErrorKey ? t(passwordErrorKey) : undefined}
          disabled={busy}
        />

        {formErrorKey ? (
          <Callout tone="blocked" className="text-sm">
            {t(formErrorKey)}
          </Callout>
        ) : null}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          busy={busy}
          busyLabel={t("signInBusy")}
          disabled={status === "misconfigured"}
        >
          {t("signInAction")}
        </Button>
      </form>
    </AuthShell>
  );
}
