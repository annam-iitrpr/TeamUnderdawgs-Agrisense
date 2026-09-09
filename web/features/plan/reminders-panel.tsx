"use client";

/**
 * Reminders: schedule, channel, opt-in and quiet hours.
 *
 * `ReminderCreate` requires a `season_id`, so a reminder cannot exist
 * independently of a season. The test account has no season yet (adding a crop
 * needs the crop catalogue, which answers 503), so the create path is rendered
 * but disabled with that stated as the reason rather than offering a form that
 * would 422 on submit.
 *
 * VERIFIED against the generated contract, not guessed:
 *   ReminderCreate { season_id, task_id?, scheduled_at, channel:
 *     in_app|whatsapp|push, opted_in, quiet_hours? { start_hour, end_hour,
 *     timezone: "Asia/Kolkata" } }
 * NOT yet exercised against the live API — no season exists to attach one to.
 */
import { Button, Callout, Card, Skeleton } from "@/components/ui";
import { ApiError } from "@/lib/api/envelope";
import { useApiQuery } from "@/lib/api/query";
import { reminderMutations, reminders as remindersApi } from "@/lib/api/routes";
import type { Reminder } from "@/lib/api/contract";
import { formatTime } from "@/lib/format";
import { BellOff, BellRing, Clock } from "lucide-react";
import { useState } from "react";

const CHANNEL_LABEL: Record<Reminder["channel"], string> = {
  in_app: "In the app",
  whatsapp: "WhatsApp",
  push: "Phone notification",
};

export function RemindersPanel({ uid }: { uid: string | null }) {
  const query = useApiQuery(
    [uid, "reminders"],
    (signal) => remindersApi.list({ signal, limit: 50 }),
    { enabled: Boolean(uid) },
  );

  const items = query.data?.items ?? [];
  const scheduled = items.filter((r) => r.status === "scheduled" || r.status === "queued");

  return (
    <Card className="p-4">
      <h3 className="text-h3 font-semibold">Reminders</h3>

      {query.isLoading ? (
        <Skeleton className="mt-3 h-16 w-full" />
      ) : query.error ? (
        <Callout tone="caution" className="mt-3 text-xs">
          {query.error.isDependencyUnavailable
            ? "Reminders are unavailable right now."
            : query.error.message}
        </Callout>
      ) : scheduled.length === 0 ? (
        <>
          <p className="mt-1.5 text-sm text-slate">No reminders set.</p>
          {/*
            Deliberately not a form. A reminder needs a season_id, and this
            account has no season because adding a crop needs the catalogue.
            A create form here would fail with a 422 the farmer cannot fix.
          */}
          <Callout tone="info" className="mt-3 text-xs">
            A reminder is attached to a crop&apos;s season. Once a field has a crop, you can be
            reminded before a spray window opens and when watering is due.
          </Callout>
        </>
      ) : (
        <ul className="mt-3 space-y-2">
          {scheduled.map((reminder) => (
            <ReminderRow key={reminder.id} reminder={reminder} onChanged={query.refetch} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReminderRow({
  reminder,
  onChanged,
}: {
  reminder: Reminder;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setOptIn(optedIn: boolean) {
    setBusy(true);
    setError(null);
    try {
      await reminderMutations.patch(reminder.id, {
        expected_version: reminder.version,
        opted_in: optedIn,
      });
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.isVersionConflict
            ? "This reminder changed elsewhere. Refresh and try again."
            : cause.message
          : "Could not update this reminder.",
      );
    } finally {
      setBusy(false);
    }
  }

  const quiet = reminder.quiet_hours;

  return (
    <li className="rounded-control border border-mist p-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1 font-semibold text-ink">
          <Clock aria-hidden className="size-3.5" />
          {formatTime(reminder.scheduled_at)}
        </span>
        <span className="text-xs text-slate">{CHANNEL_LABEL[reminder.channel]}</span>
        {!reminder.opted_in ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate">
            <BellOff aria-hidden className="size-3.5" />
            Muted
          </span>
        ) : null}
      </p>

      {quiet && (quiet.start_hour !== undefined || quiet.end_hour !== undefined) ? (
        <p className="mt-1 text-xs text-slate">
          Quiet between {String(quiet.start_hour ?? "—").padStart(2, "0")}:00 and{" "}
          {String(quiet.end_hour ?? "—").padStart(2, "0")}:00 ({quiet.timezone ?? "Asia/Kolkata"})
        </p>
      ) : null}

      {error ? <p className="mt-1.5 text-xs text-clay">{error}</p> : null}

      <Button
        variant="secondary"
        className="mt-2"
        busy={busy}
        onClick={() => void setOptIn(!reminder.opted_in)}
      >
        {reminder.opted_in ? (
          <>
            <BellOff aria-hidden className="size-4" />
            Mute
          </>
        ) : (
          <>
            <BellRing aria-hidden className="size-4" />
            Unmute
          </>
        )}
      </Button>
    </li>
  );
}

