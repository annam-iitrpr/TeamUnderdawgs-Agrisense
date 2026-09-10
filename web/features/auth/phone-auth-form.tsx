"use client";

import { useLanguage } from "@/components/language-provider";
import { toE164 } from "@/lib/phone";
import type { TranslationKey } from "@/lib/locale";
import { Button, TextField } from "@/components/ui";
import { AuthError, useAuth } from "./auth-provider";
import { AuthShell } from "./auth-shell";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function PhoneAuthForm({
  mode,
  chooser,
}: {
  mode: "sign-in" | "sign-up";
  /** The phone/email switch, rendered inside this form's own shell so both
   *  methods present one frame rather than two nested ones. */
  chooser?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const { requestPhoneOtp, verifyPhoneOtp, status } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "signed-in") window.location.replace("/");
  }, [status]);

  async function submitPhone(event: React.FormEvent) {
    event.preventDefault();
    setErrorKey(null);
    // Normalised rather than pattern-matched. Requiring a farmer to type the
    // "+91" themselves rejected their own number written the way they say it
    // aloud, which is a dead end rather than a correction.
    const target = toE164(phone);
    if (!target) {
      setErrorKey("authInvalidPhone");
      phoneRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      // The normalised form is sent and shown, so the number the code went to
      // is the number on screen.
      setPhone(target);
      await requestPhoneOtp(target);
      setStep("code");
      window.setTimeout(() => codeRef.current?.focus(), 0);
    } catch (error) {
      setErrorKey(error instanceof AuthError ? error.key : "errorTitle");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setErrorKey(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setErrorKey("authInvalidCode");
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await verifyPhoneOtp(code);
      window.location.replace("/");
    } catch (error) {
      setErrorKey(error instanceof AuthError ? error.key : "errorTitle");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={mode === "sign-in" ? t("signInTitle") : t("signUpTitle")}
      subtitle={step === "phone" ? t("phoneAuthSubtitle") : t("phoneCodeSubtitle")}
      footer={
        <p>
          {mode === "sign-in" ? t("noAccountPrompt") : t("hasAccountPrompt")} {" "}
          <Link href={mode === "sign-in" ? "/sign-up" : "/sign-in"} className="font-semibold text-forest underline">
            {mode === "sign-in" ? t("signUpAction") : t("signInAction")}
          </Link>
        </p>
      }
    >
      {chooser}
      {step === "phone" ? (
        <form onSubmit={submitPhone} noValidate className="space-y-4">
          <TextField
            ref={phoneRef}
            label={t("phoneLabel")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            hint={t("phoneHint")}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={errorKey ? t(errorKey) : undefined}
            disabled={busy}
          />
          <div id="recaptcha-container" />
          <Button type="submit" size="lg" className="w-full" busy={busy} busyLabel={t("sendCodeBusy")} disabled={status === "misconfigured"}>
            {t("sendCodeAction")}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} noValidate className="space-y-4">
          <TextField
            ref={codeRef}
            label={t("phoneCodeLabel")}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            error={errorKey ? t(errorKey) : undefined}
            disabled={busy}
          />
          <Button type="submit" size="lg" className="w-full" busy={busy} busyLabel={t("verifyCodeBusy")}>
            {t("verifyCodeAction")}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => { setStep("phone"); setCode(""); setErrorKey(null); }} disabled={busy}>
            {t("changePhone")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
