"use client";

/**
 * One task, with the actions the spec requires: complete, snooze, reschedule
 * and cancel.
 *
 * The important design point is completion. `TaskPatch.confirmed_action` takes
 * a `JournalCreate`, which is the contract's way of saying that finishing a
 * task is a claim about farm work and therefore needs to record what actually
 * happened. So "Mark done" opens a short confirmation rather than firing
 * immediately — a button must not assert that the recommended time was the
 * actual time.
 */
import { Button, Callout, Card } from "@/components/ui";
import { ApiError } from "@/lib/api/envelope";
import { tasks as tasksApi } from "@/lib/api/routes";
import type { JournalCreate, Task } from "@/lib/api/contract";
import { formatInterval, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { factPairs, reasonSentence } from "./task-grouping";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  Info,
} from "lucide-react";
import { useState } from "react";

/** Icon plus text for every priority: colour is never the only carrier. */
const PRIORITY_META: Record<
  Task["priority"],
  { label: string; icon: typeof Info; className: string }
> = {
  critical: { label: "Critical", icon: CircleAlert, className: "text-clay" },
  high: { label: "Important", icon: AlertTriangle, className: "text-amber-ink" },
  normal: { label: "Normal", icon: Info, className: "text-navy" },
  low: { label: "When you can", icon: Info, className: "text-slate" },
};

/** The journal actions a farmer can attribute a completed task to. */
const ACTIONS: Array<{ value: JournalCreate["action"]; label: string }> = [
  { value: "biostimulant_applied", label: "Sprayed biostimulant" },
  { value: "watered", label: "Watered" },
  { value: "fertilizer_applied", label: "Applied fertiliser" },
  { value: "pesticide_applied", label: "Sprayed pesticide" },
  { value: "weed_removed", label: "Removed weeds" },
  { value: "observation", label: "Just looked at it" },
];

export function TaskCard({
  task,
  overdue,
  onChanged,
}: {
  task: Task;
  overdue: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "completing" | "snoozing">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const priority = PRIORITY_META[task.priority];
  const reason = reasonSentence(task.reason.code);
  const facts = factPairs(task.reason.facts);

  async function patch(body: Parameters<typeof tasksApi.patch>[1]) {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await tasksApi.patch(task.id, body);
      setMode("idle");
      onChanged();
    } catch (cause) {
      if (cause instanceof ApiError && cause.isVersionConflict) {
        // Someone or something else changed this task — a scheduler can
        // supersede it. Refetching is the only safe move; retrying the same
        // expected_version would fail again.
        setConflict(true);
      } else if (cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError("Could not update this task. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      className={cn(
        "p-4",
        overdue && "border-clay/40 bg-[color-mix(in_srgb,var(--clay)_5%,var(--card))]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-h3 font-semibold text-ink">{task.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate">
            <span className={cn("inline-flex items-center gap-1 font-semibold", priority.className)}>
              <priority.icon aria-hidden className="size-3.5" />
              {priority.label}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarClock aria-hidden className="size-3.5" />
              {formatInterval(task.due.start_at, task.due.end_at)}
            </span>
            {task.status === "snoozed" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-navy">
                <Clock aria-hidden className="size-3.5" />
                Snoozed
              </span>
            ) : null}
          </p>
        </div>
        {overdue ? (
          <span className="shrink-0 rounded-full border border-clay/40 px-2 py-0.5 text-xs font-semibold text-clay">
            Window has passed
          </span>
        ) : null}
      </div>

      {overdue ? (
        <p className="mt-2 text-xs text-slate">
          This window has closed. Marking it done still records what you did, but check current
          conditions before spraying now — the reason it was scheduled may no longer hold.
        </p>
      ) : null}

      {reason || facts.length > 0 ? (
        <div className="mt-3 rounded-control border border-mist bg-[color-mix(in_srgb,var(--mist)_22%,var(--card))] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate">Why</p>
          {reason ? (
            <p className="mt-1 text-sm text-ink">{reason}</p>
          ) : (
            // No prose mapping for this code. Showing the raw code is better
            // than showing no reason at all, and makes the gap visible.
            <p className="mt-1 text-sm text-ink">
              Reason code <span className="font-mono text-xs">{task.reason.code}</span>
            </p>
          )}
          {facts.length > 0 ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="capitalize text-slate">{label}</dt>
                  <dd className="tabular font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}

      {conflict ? (
        <Callout tone="caution" className="mt-3 text-sm" title="This task changed">
          <p>
            It was updated somewhere else — a new forecast can replace a spray window. Refresh to
            see the current version before acting.
          </p>
          <Button variant="secondary" className="mt-2" onClick={onChanged}>
            Refresh
          </Button>
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="blocked" className="mt-3 text-sm">
          {error}
        </Callout>
      ) : null}

      {mode === "idle" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setMode("completing")} disabled={busy}>
            <Check aria-hidden className="size-4" />
            Mark done
          </Button>
          <Button variant="secondary" onClick={() => setMode("snoozing")} disabled={busy}>
            <Clock aria-hidden className="size-4" />
            Snooze
          </Button>
          <Button
            variant="secondary"
            busy={busy}
            onClick={() => void patch({ expected_version: task.version, status: "cancelled" })}
          >
            <Ban aria-hidden className="size-4" />
            Not doing it
          </Button>
        </div>
      ) : null}

      {mode === "completing" ? (
        <CompleteForm
          task={task}
          busy={busy}
          onCancel={() => setMode("idle")}
          onSubmit={(confirmed) =>
            void patch({
              expected_version: task.version,
              status: "done",
              confirmed_action: confirmed,
            })
          }
        />
      ) : null}

      {mode === "snoozing" ? (
        <SnoozeForm
          busy={busy}
          onCancel={() => setMode("idle")}
          onSubmit={(untilIso) =>
            void patch({
              expected_version: task.version,
              status: "snoozed",
              snoozed_until: untilIso,
            })
          }
        />
      ) : null}
    </Card>
  );
}

/**
 * Completion asks what actually happened.
 *
 * Defaults to "now", which is an exact instant with no timezone ambiguity. The
 * "I did this earlier" path uses a `datetime-local` input, which the browser
 * interprets in the DEVICE's timezone — correct for a farmer on an IST phone,
 * and the reason the default avoids the question entirely.
 */
function CompleteForm({
  task,
  busy,
  onCancel,
  onSubmit,
}: {
  task: Task;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (confirmed: JournalCreate) => void;
}) {
  const [action, setAction] = useState<JournalCreate["action"]>("biostimulant_applied");
  const [earlier, setEarlier] = useState(false);
  const [localWhen, setLocalWhen] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    let occurredAt = new Date().toISOString();
    if (earlier && localWhen !== "") {
      const parsed = new Date(localWhen);
      if (!Number.isNaN(parsed.getTime())) occurredAt = parsed.toISOString();
    }
    onSubmit({
      action,
      occurred_at: occurredAt,
      text: note.trim() === "" ? undefined : note.trim(),
      recommendation_id: task.source_recommendation_id ?? undefined,
    });
  }

  return (
    <div className="mt-4 rounded-control border border-mist p-3">
      <p className="text-sm font-semibold text-ink">What did you actually do?</p>
      <p className="mt-0.5 text-xs text-slate">
        This is recorded in your season journal. It is your record of the work, not just a tick.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {ACTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={action === option.value}
            onClick={() => setAction(option.value)}
            className={cn(
              "min-h-[44px] rounded-control border px-3 text-sm font-semibold",
              action === option.value
                ? "border-forest bg-forest text-white"
                : "border-mist bg-card text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={earlier}
          onChange={(e) => setEarlier(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--forest)]"
        />
        <span>
          I did this earlier, not just now
          <span className="block text-xs text-slate">
            Otherwise we record {formatTime(new Date().toISOString())} today.
          </span>
        </span>
      </label>

      {earlier ? (
        <input
          type="datetime-local"
          value={localWhen}
          onChange={(e) => setLocalWhen(e.target.value)}
          aria-label="When did you do this"
          className="mt-2 block min-h-[48px] w-full rounded-control border border-mist bg-card px-3 text-body"
        />
      ) : null}

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything worth noting (optional)"
        aria-label="Note"
        className="mt-3 block min-h-[48px] w-full rounded-control border border-mist bg-card px-3 text-body"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button busy={busy} onClick={submit}>
          <Check aria-hidden className="size-4" />
          Save and mark done
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Snooze offers concrete choices rather than a free date picker. */
function SnoozeForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (untilIso: string) => void;
}) {
  const options: Array<{ label: string; hours: number }> = [
    { label: "Later today", hours: 6 },
    { label: "Tomorrow", hours: 24 },
    { label: "In 3 days", hours: 72 },
  ];

  return (
    <div className="mt-4 rounded-control border border-mist p-3">
      <p className="text-sm font-semibold text-ink">Remind me again</p>
      <p className="mt-0.5 text-xs text-slate">
        Snoozing does not change the spray window — only when you are asked again.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option.label}
            variant="secondary"
            busy={busy}
            onClick={() =>
              onSubmit(new Date(Date.now() + option.hours * 3_600_000).toISOString())
            }
          >
            {option.label}
            <ArrowRight aria-hidden className="size-3.5" />
          </Button>
        ))}
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Collapsible history for tasks that are no longer actionable. */
export function TaskHistory({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) return null;

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-h3 font-semibold">Earlier tasks ({tasks.length})</span>
        <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul className="mt-3 space-y-2 border-t border-mist pt-3">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">{task.title}</span>
                <span className="block text-xs text-slate">
                  {formatInterval(task.due.start_at, task.due.end_at)}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold capitalize text-slate">
                {task.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
