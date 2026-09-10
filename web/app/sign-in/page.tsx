"use client";

/**
 * Sign in by mobile number, or by email and password.
 *
 * Both are offered because both are in use. Phone leads: it is the login most
 * farmers already know and it needs no password to remember. Email stays
 * because not every account has a phone — staff, agronomists, and any account
 * created before phone sign-in existed — and removing it locked those out
 * entirely.
 *
 * Email keeps a password rather than a code. Firebase has no numeric email
 * OTP; its only passwordless email option is a clickable link, so offering
 * "email OTP" would be describing something that does not exist.
 */
import { useLanguage } from "@/components/language-provider";
import { Button, Callout, PasswordField, TextField } from "@/components/ui";
import { AuthError, useAuth } from "@/features/auth/auth-provider";
import { AuthShell } from "@/features/auth/auth-shell";
import { PhoneAuthForm } from "@/features/auth/phone-auth-form";
import type { TranslationKey } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

export default function SignInPage() {
  const [method, setMethod] = useState<"phone" | "email">("phone");

  // The phone form brings its own shell, title and footer, so it replaces the
  // page rather than sitting inside another frame. Only the chooser is shared.
  return (
    <>
      {method === "phone" ? (
        <PhoneAuthForm mode="sign-in" chooser={<Chooser method={method} onChange={setMethod} />} />
      ) : (
        <EmailSignIn chooser={<Chooser method={method} onChange={setMethod} />} />
      )}
    </>
  );
}

function Chooser({
  method,
  onChange,
}: {
  method: "phone" | "email";
  onChange: (next: "phone" | "email") => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="mb-4 grid grid-cols-2 gap-1.5" role="group" aria-label={t("signInAction")}>
      {(["phone", "email"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={method === option}
          onClick={() => onChange(option)}
          className={cn(
            "min-h-[44px] rounded-control border px-3 text-sm font-semibold",
            method === option
              ? "border-forest bg-forest text-white"
              : "border-mist bg-card text-ink",
          )}
        >
          {option === "phone" ? t("signInWithPhone") : t("signInWithEmail")}
        </button>
      ))}
    </div>
  );
}

function EmailSignIn({ chooser }: { chooser: React.ReactNode }) {
  const { t } = useLanguage();
  const { signIn, status } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Translation KEYS, not resolved strings: storing the resolved text freezes
  // it in whatever language was active at submit time, so switching language
  // afterwards left English errors under Telugu labels.
  const [emailErrorKey, setEmailErrorKey] = useState<TranslationKey | null>(null);
  const [passwordErrorKey, setPasswordErrorKey] = useState<TranslationKey | null>(null);
  const [formErrorKey, setFormErrorKey] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "signed-in") window.location.replace("/");
  }, [status]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormErrorKey(null);

    const nextEmailError: TranslationKey | null =
      email.trim() === "" ? "authRequiredEmail" : null;
    const nextPasswordError: TranslationKey | null =
      password === "" ? "authRequiredPassword" : null;
    setEmailErrorKey(nextEmailError);
    setPasswordErrorKey(nextPasswordError);

    // Focus moves to the first invalid input.
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
      window.location.replace("/");
    } catch (error) {
      setFormErrorKey(error instanceof AuthError ? error.key : "errorTitle");
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t("signInTitle")} subtitle={t("signInSubtitle")}>
      {chooser}

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
