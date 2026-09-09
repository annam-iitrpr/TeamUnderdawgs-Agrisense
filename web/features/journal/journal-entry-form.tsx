"use client";

import { Button, Callout, Card, TextField } from "@/components/ui";
import { newIdempotencyKey } from "@/lib/api/client";
import { ApiError, fieldErrors } from "@/lib/api/envelope";
import type { JournalCreate } from "@/lib/api/contract";
import { seasons as seasonsApi } from "@/lib/api/routes";
import { cn } from "@/lib/utils";
import { useMemo, useRef, useState } from "react";
import {
  ACTION_META,
  JOURNAL_ACTIONS,
  QUANTITY_UNITS,
  type JournalAction,
} from "./actions";

/**
 * IST is UTC+05:30 with no daylight saving, so a wall-clock time can be turned
 * into an instant by appending the offset rather than going through the
 * device's timezone.
 *
 * This matters: `<input type="datetime-local">` yields a bare wall-clock string
 * with no zone, and `new Date(thatString)` interprets it in the *browser's*
 * timezone. A farmer whose phone is set to the wrong region would otherwise
 * have every spray time silently shifted, which is exactly the class of bug
 * the app's IST-pinned formatters exist to prevent. "07:00" means 07:00 in the
 * field, so it is anchored to +05:30 explicitly.
 */
function istLocalToInstant(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const parsed = new Date(`${local}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Current IST wall clock, formatted for a datetime-local input. */
function nowInIstLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function JournalEntryForm({
  seasonId,
  onSaved,
  onCancel,
}: {
  seasonId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [action, setAction] = useState<JournalAction>("watered");
  const [occurredLocal, setOccurredLocal] = useState(nowInIstLocal);
  const [text, setText] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<string>(ACTION_META.watered.defaultUnit ?? "litre");
  const [cost, setCost] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perField, setPerField] = useState<Record<string, string>>({});

  /**
   * Minted once for this open form and reused on every retry, so a timeout
   * followed by a second tap records one entry rather than two. A fresh key per
   * attempt would defeat the guarantee entirely.
   */
  const idempotencyKey = useRef(newIdempotencyKey());

  const meta = ACTION_META[action];

  const occurredAt = useMemo(() => istLocalToInstant(occurredLocal), [occurredLocal]);
  const inFuture = useMemo(
    () => (occurredAt ? Date.parse(occurredAt) > Date.now() + 60_000 : false),
    [occurredAt],
  );

  function selectAction(next: JournalAction) {
    setAction(next);
    const nextUnit = ACTION_META[next].defaultUnit;
    if (nextUnit) setUnit(nextUnit);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPerField({});

    if (!occurredAt) {
      setPerField({ occurred_at: "Enter the date and time this happened." });
      return;
    }
    if (inFuture) {
      // A journal records what already happened. A future time is a typo, and
      // accepting it would corrupt the adherence record the whole feature feeds.
      setPerField({ occurred_at: "This is in the future. A journal records what already happened." });
      return;
    }

    const parsedQuantity = quantity.trim() === "" ? null : Number(quantity.replace(",", "."));
    if (parsedQuantity !== null && !Number.isFinite(parsedQuantity)) {
      setPerField({ quantity: "Enter only a number, for example 200" });
      return;
    }
    const parsedCost = cost.trim() === "" ? null : Number(cost.replace(",", "."));
    if (parsedCost !== null && !Number.isFinite(parsedCost)) {
      setPerField({ cost_inr: "Enter only a number, for example 1500" });
      return;
    }

    const body: JournalCreate = {
      action,
      occurred_at: occurredAt,
      ...(text.trim() === "" ? {} : { text: text.trim() }),
      ...(parsedCost === null ? {} : { cost_inr: parsedCost }),
      // `quantities` is an array of Measurement on the contract, not a single
      // value + unit. One measurement is sent; a null value with a stated unit
      // is still meaningful ("I watered, amount unknown").
      ...(parsedQuantity === null
        ? {}
        : { quantities: [{ value: parsedQuantity, unit }] }),
    };

    setSaving(true);
    try {
      await seasonsApi.addJournalEntry(seasonId, body, idempotencyKey.current);
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fields = fieldErrors(cause);
        if (Object.keys(fields).length > 0) setPerField(fields);
        setError(
          cause.isDependencyUnavailable
            ? "The journal service is unavailable right now. Nothing was saved — try again in a moment."
            : cause.message,
        );
      } else {
        setError("We cannot reach AgriSense right now. Please try again in a moment.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" className="p-4">
      <h2 className="text-h3 font-semibold">What happened on your field?</h2>

      <form onSubmit={submit} noValidate className="mt-3 space-y-4">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Action</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {JOURNAL_ACTIONS.map((option) => {
              const optionMeta = ACTION_META[option];
              const selected = option === action;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectAction(option)}
                  className={cn(
                    "inline-flex min-h-[44px] items-center gap-1.5 rounded-control border px-3 text-sm font-semibold",
                    selected
                      ? "border-forest bg-forest text-white"
                      : "border-mist bg-card text-ink",
                  )}
                >
                  <optionMeta.icon aria-hidden className="size-4 shrink-0" />
                  {optionMeta.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-slate">{meta.hint}</p>
        </fieldset>

        <TextField
          label="When did this happen?"
          type="datetime-local"
          value={occurredLocal}
          onChange={(e) => setOccurredLocal(e.target.value)}
          hint="Indian Standard Time."
          error={perField.occurred_at}
          disabled={saving}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <TextField
              label="How much? (optional)"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              error={perField.quantity}
              disabled={saving}
            />
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Unit">
              {QUANTITY_UNITS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={unit === option}
                  onClick={() => setUnit(option)}
                  disabled={saving}
                  className={cn(
                    "min-h-[44px] rounded-control border px-3 text-sm font-semibold",
                    unit === option
                      ? "border-forest bg-forest text-white"
                      : "border-mist bg-card text-ink",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <TextField
            label="What did it cost? (optional)"
            inputMode="decimal"
            hint="In rupees."
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            error={perField.cost_inr}
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="journal-note" className="block text-sm font-semibold text-ink">
            Note (optional)
          </label>
          <textarea
            id="journal-note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            disabled={saving}
            className="block w-full rounded-control border border-mist bg-card px-3 py-2 text-body text-ink"
          />
        </div>

        {/*
          Photo and voice attachment is deliberately NOT built here. The upload
          path is a three-step flow — request a ticket, PUT the bytes to a
          signed URL, then complete with a SHA-256 of the content — and none of
          it has been exercised against the live service. A picker that appeared
          to work and silently dropped the file would be worse than none.
        */}
        <Callout tone="info" className="text-xs" title="Photos and voice notes are not ready yet">
          You can record what happened in words now. Attaching a photo or a voice note needs the
          media upload path, which is not wired up on this screen.
        </Callout>

        {error ? (
          <Callout tone="blocked" className="text-sm">
            {error}
          </Callout>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" busy={saving} busyLabel="Saving" className="flex-1">
            Save to journal
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
