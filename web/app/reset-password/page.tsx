"use client";

import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n";
import { Button, Callout, TextField } from "@/components/ui";
import { AuthError, useAuth } from "@/features/auth/auth-provider";
import { AuthShell } from "@/features/auth/auth-shell";
import Link from "next/link";
import { useRef, useState } from "react";

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const { sendPasswordReset, status } = useAuth();

  const [email, setEmail] = useState("");
  // Keys, not resolved strings, so a language change re-translates the error.
  const [emailErrorKey, setEmailErrorKey] = useState<TranslationKey | null>(null);
  const [formErrorKey, setFormErrorKey] = useState<TranslationKey | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormErrorKey(null);

    if (email.trim() === "") {
      setEmailErrorKey("authRequiredEmail");
      emailRef.current?.focus();
      return;
    }
    setEmailErrorKey(null);

    setBusy(true);
    try {
      await sendPasswordReset(email);
      // The same confirmation shows whether or not an account exists. Anything
      // else would confirm which addresses are registered.
      setSent(true);
    } catch (error) {
      setFormErrorKey(error instanceof AuthError ? error.key : "errorTitle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t("resetTitle")}
      subtitle={sent ? undefined : t("resetSubtitle")}
      footer={
        <p>
          <Link href="/sign-in" className="font-semibold text-forest underline">
            {t("back")}
          </Link>
        </p>
      }
    >
      {sent ? (
        <Callout tone="success" title={t("resetTitle")}>
          {t("resetSent")}
        </Callout>
      ) : (
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
            disabled={status === "misconfigured"}
          >
            {t("resetAction")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
