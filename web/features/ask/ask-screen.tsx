"use client";

/**
 * P1-08 — Ask, the contextual assistant.
 *
 * The defining fact about this screen today: **the assistant produces no
 * replies.** Verified against the deployed API — creating a conversation
 * answers 201, posting a message answers 201 and the message is stored, and
 * fetching the thread returns only the farmer's own message. Gemini is not
 * configured in the deployed environment, so nothing generates an answer.
 *
 * That makes the honest failure mode the main design problem. A chat UI that
 * accepts a question and then shows a spinner forever is the worst possible
 * rendering of this state: the farmer waits, assumes it is slow, and tries
 * again. So the screen sends the message, waits a bounded number of times for
 * an assistant turn, and then says plainly that no answer is coming and why —
 * while confirming the question itself was saved.
 *
 * Deterministic alternatives are offered instead of an LLM, which is what the
 * spec asks for when the language model is unavailable.
 */
import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import { Button, Callout, Card, ErrorState, Skeleton, TextField } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { useActiveField } from "@/features/fields/active-field";
import { newIdempotencyKey } from "@/lib/api/client";
import type { Conversation, Field, Message } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { useApiQuery } from "@/lib/api/query";
import {
  conversations as conversationsApi,
  fields as fieldsApi,
} from "@/lib/api/routes";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BookOpen, Send, Sprout } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/** How many times to look for an assistant turn before saying none is coming. */
const REPLY_POLL_ATTEMPTS = 4;
const REPLY_POLL_INTERVAL_MS = 1500;

export function AskScreen() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const fieldsQuery = useApiQuery(
    [uid, "fields"],
    (signal) => fieldsApi.list({ signal, limit: 50 }),
    { enabled: Boolean(uid) },
  );
  const visible = (fieldsQuery.data?.items ?? []).filter((f) => !f.archived);
  const { activeId } = useActiveField(
    uid,
    visible.map((f) => f.id),
  );
  const activeField = visible.find((f) => f.id === activeId) ?? null;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once we have waited for a reply and none arrived. */
  const [replyUnavailable, setReplyUnavailable] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages.length, replyUnavailable]);

  /** Creates the conversation on first send, scoped to the active field and
   *  the farmer's chosen language so the server knows both. */
  const ensureConversation = useCallback(async (): Promise<Conversation> => {
    if (conversation) return conversation;
    const { data } = await conversationsApi.create(
      {
        field_id: activeField?.id ?? null,
        season_id: null,
        language,
      },
      newIdempotencyKey(),
    );
    setConversation(data);
    return data;
  }, [conversation, activeField, language]);

  async function send() {
    const text = draft.trim();
    if (text === "" || sending) return;

    setSending(true);
    setError(null);
    setReplyUnavailable(false);

    try {
      const convo = await ensureConversation();
      const { data: sent } = await postMessage(convo.id, text);
      setMessages((prev) => [...prev, sent]);
      setDraft("");

      // Look for an assistant turn a bounded number of times. If none appears,
      // stop and say so — never leave a spinner running indefinitely.
      let found = false;
      for (let attempt = 0; attempt < REPLY_POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, REPLY_POLL_INTERVAL_MS));
        const { data: page } = await conversationsApi.messages(convo.id, { limit: 100 });
        const items = page.items ?? [];
        setMessages(items);
        if (items.some((m) => m.role === "assistant")) {
          found = true;
          break;
        }
      }
      if (!found) setReplyUnavailable(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.isDependencyUnavailable
            ? "The assistant service is unavailable right now. Your question was not sent."
            : cause.message
          : t("errorUnreachable"),
      );
    } finally {
      setSending(false);
    }
  }

  if (fieldsQuery.isLoading) {
    return (
      <AppShell title={t("navAsk")}>
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </AppShell>
    );
  }

  if (fieldsQuery.error) {
    return (
      <AppShell title={t("navAsk")}>
        <ErrorState
          title={t("errorTitle")}
          message={fieldsQuery.error.message}
          retryLabel={t("retry")}
          onRetry={fieldsQuery.error.retryable ? fieldsQuery.refetch : undefined}
        />
      </AppShell>
    );
  }

  return (
    <AppShell title={t("navAsk")}>
      <div className="mx-auto flex max-w-[48rem] flex-col gap-4">
        <ContextStrip field={activeField} />

        <Card className="flex min-h-[18rem] flex-col p-0">
          <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && !sending ? (
              <Opening />
            ) : (
              messages.map((message) => <Bubble key={message.id} message={message} />)
            )}

            {sending ? (
              <p className="text-center text-sm text-slate" aria-live="polite">
                Sending your question…
              </p>
            ) : null}

            {replyUnavailable ? <NoAnswerAvailable /> : null}
          </div>

          <form
            className="flex items-end gap-2 border-t border-mist p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <TextField
              label="Your question"
              className="flex-1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about your field"
              disabled={sending}
            />
            <Button type="submit" size="lg" busy={sending} disabled={draft.trim() === ""}>
              <Send aria-hidden className="size-4" />
              Send
            </Button>
          </form>
        </Card>

        {error ? (
          <Callout tone="blocked" title={t("errorTitle")}>
            {error}
          </Callout>
        ) : null}

        {/* Voice input is part of P1-08 but needs the media upload path, which
            is unverified. Saying so beats a microphone button that discards
            what the farmer said. */}
        <Callout tone="info" className="text-xs">
          Voice questions and photo attachments are not wired up yet, so only typed questions work
          on this screen for now.
        </Callout>
      </div>
    </AppShell>
  );
}

/** Posted separately so `send()` reads linearly. */
async function postMessage(conversationId: string, text: string) {
  return conversationsApi.postMessage(conversationId, { text }, newIdempotencyKey());
}

function ContextStrip({ field }: { field: Field | null }) {
  return (
    <Card className="p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate">
        What the assistant can see
      </p>
      {field ? (
        <p className="mt-1 text-ink">
          <span className="font-semibold">{field.name}</span> — your own field records only.
        </p>
      ) : (
        <p className="mt-1 text-slate">
          No field selected yet, so there is no field context to answer from.
        </p>
      )}
      <p className="mt-1 text-xs text-slate">
        It can only read your own records. It cannot see other farmers.
      </p>
    </Card>
  );
}

function Opening() {
  return (
    <div className="py-6 text-center">
      <p className="text-h3 font-semibold">Ask about your field</p>
      <p className="mx-auto mt-1.5 max-w-[36ch] text-sm text-slate">
        Questions about your own crop, water, spending or season records — in your own language.
      </p>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const mine = message.role === "user";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-card px-3 py-2 text-sm",
          mine ? "bg-forest text-white" : "border border-mist bg-card text-ink",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.text ?? ""}</p>
        <p className={cn("mt-1 text-xs", mine ? "text-white/70" : "text-slate")}>
          {formatTime(message.created_at)}
        </p>

        {/* Citations. The spec requires an answer's facts to link back to the
            record they came from. Only ids are returned, so they are listed
            rather than resolved — see IR-009. */}
        {message.source_record_ids && message.source_record_ids.length > 0 ? (
          <p className="mt-1 text-xs opacity-80">
            Based on {message.source_record_ids.length} of your records
          </p>
        ) : null}

        {message.proposal_ids && message.proposal_ids.length > 0 ? (
          <p className="mt-1 text-xs font-semibold">
            Suggests {message.proposal_ids.length} change
            {message.proposal_ids.length === 1 ? "" : "s"} to your data — confirm below
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The honest dead end.
 *
 * Shown once we have waited and no assistant turn arrived. It states what
 * happened, that the question was still saved, and offers the deterministic
 * routes that do work — rather than inviting a retry that will behave the same.
 */
function NoAnswerAvailable() {
  return (
    <Callout tone="caution" title="No answer available">
      <p>
        Your question was saved, but the assistant is not answering: the language model is not
        configured in this environment, so there is nothing to generate a reply.
      </p>
      <p className="mt-2">Trying again will get the same result. These do work now:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          href="/journal"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-mist bg-card px-3 text-sm font-semibold"
        >
          <BookOpen aria-hidden className="size-4 text-forest" />
          Record what happened
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-mist bg-card px-3 text-sm font-semibold"
        >
          <Sprout aria-hidden className="size-4 text-forest" />
          See your fields
        </Link>
      </div>
    </Callout>
  );
}
