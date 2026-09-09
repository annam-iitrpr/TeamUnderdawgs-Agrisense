"use client";

import { Callout, Card, EmptyState, ErrorState, Skeleton, UnknownValue } from "@/components/ui";
import type { ApiError } from "@/lib/api/envelope";
import type { Field, JournalEntry, Season } from "@/lib/api/contract";
import { formatDate, formatMoney, formatQuantity, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CheckCircle2, CircleDashed, Paperclip, XCircle } from "lucide-react";
import { ACTION_META, JOURNAL_ACTIONS, standingLabel, type JournalAction } from "./actions";

export function JournalTimeline({
  entries,
  field,
  season,
  loading,
  error,
  onRetry,
  activeFilters,
  onToggleFilter,
  onClearFilters,
}: {
  entries: JournalEntry[];
  field: Field;
  season: Season;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  activeFilters: ReadonlySet<JournalAction>;
  onToggleFilter: (action: JournalAction) => void;
  onClearFilters: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-full rounded-card" />
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-24 w-full rounded-card" />
      </div>
    );
  }

  if (error) {
    // A service that cannot be reached is a different statement from a season
    // with no entries, and conflating them would tell a farmer their record is
    // empty when it is merely unavailable.
    return (
      <ErrorState
        title={
          error.isDependencyUnavailable
            ? "The journal service is unavailable"
            : "Could not load this journal"
        }
        message={
          error.isDependencyUnavailable
            ? "Your entries are safe. AgriSense cannot read them right now — this is a service problem, not something you have done."
            : error.message
        }
        retryLabel="Try again"
        onRetry={error.retryable ? onRetry : undefined}
      />
    );
  }

  // Newest first. The server's order is not assumed.
  const sorted = [...entries].sort(
    (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at),
  );
  const filtered =
    activeFilters.size === 0 ? sorted : sorted.filter((e) => activeFilters.has(e.action));

  return (
    <div className="space-y-3">
      <Filters
        entries={sorted}
        activeFilters={activeFilters}
        onToggleFilter={onToggleFilter}
        onClearFilters={onClearFilters}
      />

      {sorted.length === 0 ? (
        <EmptyState
          title="No entries yet"
          message="Record what you do on this field — watering, spraying, weeding, what you notice — and it builds the record of this season."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          message="This season has entries, but none of the kinds you have selected."
        />
      ) : (
        <ol className="space-y-3">
          {filtered.map((entry) => (
            <li key={entry.id}>
              <EntryCard entry={entry} field={field} season={season} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Filters({
  entries,
  activeFilters,
  onToggleFilter,
  onClearFilters,
}: {
  entries: JournalEntry[];
  activeFilters: ReadonlySet<JournalAction>;
  onToggleFilter: (action: JournalAction) => void;
  onClearFilters: () => void;
}) {
  const counts = new Map<JournalAction, number>();
  for (const entry of entries) {
    counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onClearFilters}
        aria-pressed={activeFilters.size === 0}
        className={cn(
          "min-h-[44px] rounded-control border px-3 text-sm font-semibold",
          activeFilters.size === 0
            ? "border-forest bg-forest text-white"
            : "border-mist bg-card text-ink",
        )}
      >
        All
      </button>
      {JOURNAL_ACTIONS.map((action) => {
        const meta = ACTION_META[action];
        const count = counts.get(action) ?? 0;
        const selected = activeFilters.has(action);
        return (
          <button
            key={action}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggleFilter(action)}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-control border px-3 text-sm font-semibold",
              selected ? "border-forest bg-forest text-white" : "border-mist bg-card text-ink",
              // A count of zero is shown, not hidden: "no weeding recorded" is
              // information, and a vanishing filter would look like a bug.
              count === 0 && !selected && "text-slate",
            )}
          >
            <meta.icon aria-hidden className="size-4 shrink-0" />
            {meta.label}
            <span className="tabular text-xs font-normal opacity-80">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

const STANDING_ICON = {
  confirmed: CheckCircle2,
  rejected: XCircle,
  unreviewed: CircleDashed,
} as const;

function EntryCard({
  entry,
  field,
  season,
}: {
  entry: JournalEntry;
  field: Field;
  season: Season;
}) {
  const meta = ACTION_META[entry.action];
  const standing = entry.observation_quality;
  const StandingIcon = STANDING_ICON[standing];

  const quantities = entry.quantities ?? [];
  const cost = entry.cost_inr;

  return (
    <Card
      className={cn(
        "p-4",
        // An unreviewed entry is what the farmer reported and nothing more, so
        // it is not styled as settled fact. A rejected one stays visible in
        // their own record rather than disappearing.
        standing === "unreviewed" && "border-dashed",
        standing === "rejected" && "border-clay/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-h3 font-semibold">
          <meta.icon aria-hidden className="size-4 shrink-0 text-forest" />
          {meta.label}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-slate">
          <StandingIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0",
              standing === "confirmed" && "text-forest",
              standing === "rejected" && "text-clay",
            )}
          />
          {standingLabel(standing)}
        </p>
      </div>

      <p className="mt-1 text-sm text-slate">
        {formatDate(entry.occurred_at)} at {formatTime(entry.occurred_at)}
      </p>

      {/*
        Which field and season this belongs to. JournalEntry carries only
        season_id on the contract — there is no field_id — so the field is the
        one whose season is being viewed, passed in rather than inferred.
      */}
      <p className="mt-0.5 text-xs text-slate">
        {field.name} · season {season.id.slice(0, 8)} · entered from {entry.source}
      </p>

      {entry.text ? <p className="mt-2 text-body text-ink">{entry.text}</p> : null}

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-slate">Amount</dt>
          <dd className="font-semibold text-ink">
            {quantities.length === 0 ? (
              <UnknownValue label="Not recorded" />
            ) : (
              quantities.map((measurement, index) => (
                <span key={`${measurement.unit}-${index}`} className="mr-2">
                  {measurement.value === null ? (
                    <UnknownValue
                      label={`Unknown ${measurement.unit}`}
                      reason={measurement.missing_reason ?? undefined}
                    />
                  ) : (
                    formatQuantity(measurement.value, measurement.unit)
                  )}
                </span>
              ))
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Cost</dt>
          <dd className="font-semibold text-ink">
            {/* Unknown is never zero: an unrecorded cost is not ₹0. */}
            {cost === null || cost === undefined ? (
              <UnknownValue label="Not recorded" />
            ) : (
              formatMoney(cost)
            )}
          </dd>
        </div>
      </dl>

      {entry.media_ids && entry.media_ids.length > 0 ? (
        <p className="mt-3 flex items-center gap-1.5 border-t border-mist pt-2 text-xs text-slate">
          <Paperclip aria-hidden className="size-3.5 shrink-0" />
          {entry.media_ids.length} attachment{entry.media_ids.length === 1 ? "" : "s"} — viewing
          attachments is not built yet
        </p>
      ) : null}

      {standing === "unreviewed" ? (
        <Callout tone="info" className="mt-3 text-xs">
          This is your own record of what happened. It has not been checked against anything, and
          a note or photo is not evidence of how the crop responded.
        </Callout>
      ) : null}
    </Card>
  );
}
