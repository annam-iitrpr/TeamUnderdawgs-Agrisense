"use client";

/**
 * A change the assistant has proposed to the farmer's own records.
 *
 * Nothing here is applied until Confirm is pressed. The card exists so that
 * approval is never blind: it fetches the proposal and shows the operation, the
 * record it targets and every value it would write, before offering the button.
 * If the proposal cannot be read, Confirm is not offered at all — a farmer must
 * not approve something the screen could not display.
 */
import { Button, Callout, Card, Skeleton } from "@/components/ui";
import { newIdempotencyKey } from "@/lib/api/client";
import type { ProposedMutation } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { proposals as proposalsApi } from "@/lib/api/routes";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const OPERATION_LABEL: Record<string, string> = {
  "journal.create": "Add a journal entry",
  "field.update": "Change field details",
  "task.update": "Update a task",
  "season.close": "Close this season",
};

/** Values are shown as they will be written, with keys made readable. */
function readableKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? `${value.length} item(s)` : "None";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ProposalCard({
  proposalId,
  onApplied,
}: {
  proposalId: string;
  onApplied?: () => void;
}) {
  const [proposal, setProposal] = useState<ProposedMutation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"confirmed" | "cancelled" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    proposalsApi
      .get(proposalId, { signal: controller.signal })
      .then(({ data }) => {
        if (!cancelled) setProposal(data);
      })
      .catch((cause) => {
        if (cancelled || controller.signal.aborted) return;
        setLoadError(
          cause instanceof ApiError ? cause.message : "This proposed change could not be read.",
        );
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [proposalId]);

  const act = useCallback(
    async (kind: "confirm" | "cancel") => {
      if (!proposal || busy) return;
      setBusy(true);
      setActionError(null);
      try {
        const call = kind === "confirm" ? proposalsApi.confirm : proposalsApi.cancel;
        await call(proposal.id, proposal.expected_version, newIdempotencyKey());
        setOutcome(kind === "confirm" ? "confirmed" : "cancelled");
        if (kind === "confirm") onApplied?.();
      } catch (cause) {
        setActionError(
          cause instanceof ApiError
            ? cause.status === 409
              ? "This record changed since the suggestion was made, so it was not applied. Ask again to get a fresh one."
              : cause.message
            : "That change could not be applied.",
        );
      } finally {
        setBusy(false);
      }
    },
    [proposal, busy, onApplied],
  );

  if (loadError) {
    // No Confirm button here on purpose: approving an unreadable change is worse than none.
    return (
      <Callout tone="caution" title="Suggested change could not be shown">
        <p>{loadError}</p>
        <p className="mt-1">Make the change directly instead.</p>
      </Callout>
    );
  }

  if (!proposal) {
    return <Skeleton className="h-28 w-full rounded-card" aria-label="Loading suggested change" />;
  }

  if (outcome) {
    return (
      <Callout tone={outcome === "confirmed" ? "success" : "info"} title={
        outcome === "confirmed" ? "Change saved" : "Change not made"
      }>
        <p>
          {outcome === "confirmed"
            ? "Your records have been updated."
            : "Nothing was changed."}
        </p>
      </Callout>
    );
  }

  const expired = proposal.status === "expired";
  const pending = proposal.status === "pending";
  const values = (proposal.new_values ?? {}) as Record<string, unknown>;

  return (
    <Card className="border-forest/30">
      <p className="text-sm font-semibold text-ink">
        {OPERATION_LABEL[proposal.operation] ?? proposal.operation}
      </p>
      <p className="mt-1 text-xs text-slate">
        Suggested by the assistant. Nothing is saved until you confirm it.
      </p>

      <dl className="mt-3 space-y-1.5">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <dt className="text-slate">{readableKey(key)}</dt>
            <dd className="font-medium text-ink">{readableValue(value)}</dd>
          </div>
        ))}
        {Object.keys(values).length === 0 ? (
          <p className="text-sm text-slate">No values to change.</p>
        ) : null}
      </dl>

      {expired ? (
        <p className="mt-3 text-sm text-clay">
          This suggestion expired. Ask again to get a fresh one.
        </p>
      ) : null}
      {!pending && !expired ? (
        <p className="mt-3 text-sm text-slate">This suggestion is no longer open.</p>
      ) : null}
      {actionError ? <p className="mt-3 text-sm text-clay">{actionError}</p> : null}

      {pending ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => act("confirm")} disabled={busy}>
            <Check aria-hidden className="size-4" />
            {busy ? "Saving…" : "Confirm this change"}
          </Button>
          <Button variant="secondary" onClick={() => act("cancel")} disabled={busy}>
            <X aria-hidden className="size-4" />
            Not now
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
