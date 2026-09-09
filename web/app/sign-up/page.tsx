"use client";

import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n";
import { Button, Callout, PasswordField, TextField } from "@/components/ui";
import { AuthError, useAuth } from "@/features/auth/auth-provider";
import { AuthShell } from "@/features/auth/auth-shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const MIN_PASSWORD_LENGTH = 8;

export default function SignUpPage() {
  const { t } = useLanguage();
  const { signUp, status } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Keys, not resolved strings, so errors re-translate when the language
  // changes rather than staying in the language active at submit time.
  const [emailErrorKey, setEmailErrorKey] = useState<TranslationKey | null>(null);
  const [passwordErrorKey, setPasswordErrorKey] = useState<TranslationKey | null>(null);
  const [formErrorKey, setFormErrorKey] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "signed-in") router.replace("/");
  }, [status, router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormErrorKey(null);

    const nextEmailError: TranslationKey | null =
      email.trim() === "" ? "authRequiredEmail" : null;
    // Length is checked client-side purely so the farmer gets the message
    // before a round trip. Firebase enforces its own policy regardless.
    const nextPasswordError: TranslationKey | null =
      password === ""
        ? "authRequiredPassword"
        : password.length < MIN_PASSWORD_LENGTH
          ? "authWeakPassword"
          : null;

    setEmailErrorKey(nextEmailError);
    setPasswordErrorKey(nextPasswordError);

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
      await signUp(email, password);
      router.replace("/");
    } catch (error) {
      setFormErrorKey(error instanceof AuthError ? error.key : "errorTitle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t("signUpTitle")}
      subtitle={t("signUpSubtitle")}
      footer={
        <p>
          {t("hasAccountPrompt")}{" "}
          <Link href="/sign-in" className="font-semibold text-forest underline">
            {t("signInAction")}
          </Link>
        </p>
      }
    >
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
          autoComplete="new-password"
          hint={t("passwordMinHint")}
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
          busyLabel={t("signUpBusy")}
          disabled={status === "misconfigured"}
        >
          {t("signUpAction")}
        </Button>
      </form>
    </AuthShell>
  );
}
