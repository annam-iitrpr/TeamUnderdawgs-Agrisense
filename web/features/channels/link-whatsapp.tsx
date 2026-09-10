"use client";

/**
 * Binding a WhatsApp number to this account.
 *
 * This screen is why the chatbot answered nobody. Inbound messages arrived and
 * were accepted, but an unlinked sender is deliberately never guessed into an
 * account — so the server ignored them silently, with no reply and no error.
 * The route to link a number has existed all along; nothing in the app called
 * it, so no farmer had ever linked one.
 *
 * The flow is deliberately the awkward way round — we issue a code and the
 * farmer sends it from WhatsApp, rather than asking them to type their number
 * here. Typing a number proves nothing: anyone could type anyone's. Sending a
 * code *from* the number proves they hold the handset, which is the only thing
 * that makes it safe to attach their field records to it.
 */
import { Button, Callout, Card } from "@/components/ui";
import { newIdempotencyKey } from "@/lib/api/client";
import type { ChannelLinkChallenge } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { channels } from "@/lib/api/routes";
import { Check, Copy, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

/** Matches the consent record the backend stores against the channel. */
const CONSENT_VERSION = "2026-09-01";

/** The business number a farmer sends the code to. */
const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";

function minutesLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60000));
}

export function LinkWhatsapp({ linked }: { linked: boolean }) {
  const [challenge, setChallenge] = useState<ChannelLinkChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(0);

  // A single-use code that expires in ten minutes. Counting down beats showing
  // a timestamp: a farmer needs to know whether to hurry or ask for a new one.
  useEffect(() => {
    if (!challenge) return;
    const tick = () => setRemaining(minutesLeft(challenge.expires_at));
    tick();
    const timer = window.setInterval(tick, 20_000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  async function request() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { data } = await channels.linkWhatsapp(CONSENT_VERSION, newIdempotencyKey());
      setChallenge(data);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.status === 403
            ? "Sign in with your phone number first. Linking WhatsApp needs an account whose number has been confirmed by SMS."
            : cause.message
          : "We cannot reach AgriSense right now. Please try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await channels.unlinkWhatsapp();
      setChallenge(null);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "That could not be undone just now.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(`LINK ${code}`);
      setCopied(true);
    } catch {
      // Clipboard access is refused in some browsers and on insecure origins.
      // The code is on screen to be typed, so this is a convenience, not a step.
    }
  }

  return (
    <Card as="section" className="p-4">
      <h2 className="flex items-center gap-2 text-h3 font-semibold">
        <MessageCircle aria-hidden className="size-4 text-forest" />
        WhatsApp
      </h2>

      {linked ? (
        <>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-forest">
            <Check aria-hidden className="size-4" />
            Your WhatsApp is connected.
          </p>
          <p className="mt-1 text-sm text-slate">
            You can ask AgriSense questions and log field work by message. Say{" "}
            <span className="font-semibold">menu</span> to see what it understands.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void unlink()} disabled={busy}>
            Disconnect WhatsApp
          </Button>
        </>
      ) : challenge ? (
        <>
          <p className="mt-1.5 text-sm text-slate">
            Send this message from the WhatsApp number you want to connect
            {WHATSAPP_NUMBER ? (
              <>
                {" "}
                to <span className="font-semibold text-ink">{WHATSAPP_NUMBER}</span>
              </>
            ) : null}
            :
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-control border border-mist bg-card px-3 py-2 font-mono text-sm font-semibold text-ink">
              LINK {challenge.code}
            </code>
            <Button variant="secondary" onClick={() => void copy(challenge.code)}>
              {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <p className="mt-2 text-xs text-slate">
            {remaining > 0
              ? `This code works once and expires in about ${remaining} minute${remaining === 1 ? "" : "s"}.`
              : "This code has expired. Ask for a new one."}
          </p>

          <Button variant="secondary" className="mt-3" onClick={() => void request()} busy={busy}>
            Get a new code
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-slate">
            Connect WhatsApp to ask questions and record field work by message, without opening
            the app. AgriSense will only reply to a number you have connected here.
          </p>
          <Button className="mt-3" onClick={() => void request()} busy={busy} busyLabel="Getting a code">
            Connect WhatsApp
          </Button>
        </>
      )}

      {error ? (
        <Callout tone="blocked" className="mt-3 text-sm">
          {error}
        </Callout>
      ) : null}
    </Card>
  );
}
