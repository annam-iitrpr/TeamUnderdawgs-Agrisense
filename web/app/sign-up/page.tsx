"use client";

/**
 * Create an account by mobile number, or by email.
 *
 * Both are offered because both are used: a farmer signs up with the number
 * they already know, and staff and agronomists sign up with an address. Sign-up
 * previously offered only the phone route, so an email account could exist but
 * could not be created here.
 *
 * The phone route takes a password rather than a code for every number except
 * the one on the SMS allowlist. That is a deliberate trade and it is described
 * where it is made, in `lib/phone.ts`: a password account against an unverified
 * number does not prove the person holds the SIM.
 */
import { useLanguage } from "@/components/language-provider";
import { Button, Callout, PasswordField, TextField } from "@/components/ui";
import { AuthError, useAuth } from "@/features/auth/auth-provider";
import { AuthShell } from "@/features/auth/auth-shell";
import { PhoneAuthForm } from "@/features/auth/phone-auth-form";
import type { TranslationKey } from "@/lib/locale";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export default function SignUpPage() {
  const [method, setMethod] = useState<"phone" | "email">("phone");
  return method === "phone" ? (
    <PhoneAuthForm mode="sign-up" chooser={<Chooser method={method} onChange={setMethod} />} />
  ) : (
    <EmailSignUp chooser={<Chooser method={method} onChange={setMethod} />} />
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
    <div className="mb-4 grid grid-cols-2 gap-1.5" role="group" aria-label={t("signUpAction")}>
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
          {option === "phone" ? t("phoneLabel") : t("emailLabel")}
        </button>
      ))}
    </div>
  );
}

function EmailSignUp({ chooser }: { chooser: React.ReactNode }) {
  const { t } = useLanguage();
  const { signUp, status } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Translation keys rather than resolved text: storing the resolved string
  // freezes it in whatever language was active at submit time.
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
    // Stated before the request rather than after it: Firebase refuses a short
    // password with a code the farmer cannot act on.
    const nextPasswordError: TranslationKey | null =
      password === ""
        ? "authRequiredPassword"
        : password.length < 8
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
      window.location.replace("/");
    } catch (error) {
      setFormErrorKey(error instanceof AuthError ? error.key : "errorTitle");
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t("signUpTitle")}
      subtitle={t("signInSubtitle")}
      footer={
        <p>
          {t("hasAccountPrompt")}{" "}
          <Link href="/sign-in" className="font-semibold text-forest underline">
            {t("signInAction")}
          </Link>
        </p>
      }
    >
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
          hint={t("passwordCreateHint")}
          autoComplete="new-password"
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
