"use client";

/**
 * P1-07 — Season Journal.
 *
 * A journal belongs to a crop season, not to a field: the contract's
 * JournalEntry carries `season_id` and nothing else that locates it. So this
 * screen has to resolve field → season before it can show anything, and the
 * realistic state on a new account is that no season exists yet.
 */
import { AppShell } from "@/components/app-shell";
import { Button, Callout, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { useActiveField } from "@/features/fields/active-field";
import { useApiQuery } from "@/lib/api/query";
import { fields as fieldsApi, seasons as seasonsApi } from "@/lib/api/routes";
import type { Field, Season } from "@/lib/api/contract";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { JournalAction } from "./actions";
import { JournalEntryForm } from "./journal-entry-form";
import { JournalTimeline } from "./journal-timeline";

export function JournalScreen() {
  const { user, status } = useAuth();
  const uid = user?.uid ?? null;

  const fieldsQuery = useApiQuery(
    [uid, "fields"],
    (signal) => fieldsApi.list({ signal, limit: 50 }),
    { enabled: Boolean(uid) },
  );

  const visible = (fieldsQuery.data?.items ?? []).filter((f) => !f.archived);
  const { activeId, setActiveId } = useActiveField(
    uid,
    visible.map((f) => f.id),
  );
  const active = visible.find((f) => f.id === activeId) ?? null;

  if (status !== "signed-in" || fieldsQuery.isLoading) {
    return (
      <AppShell title="Journal">
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-32 w-full rounded-card" />
        </div>
      </AppShell>
    );
  }

  if (fieldsQuery.error) {
    return (
      <AppShell title="Journal">
        <ErrorState
          title="Could not load your fields"
          message={fieldsQuery.error.message}
          retryLabel="Try again"
          onRetry={fieldsQuery.error.retryable ? fieldsQuery.refetch : undefined}
        />
      </AppShell>
    );
  }

  if (visible.length === 0) {
    return (
      <AppShell title="Journal">
        <EmptyState
          title="No fields yet"
          message="The journal records what you do on a field through a season. Register a field first."
          action={
            <Link href="/onboarding">
              <Button size="lg">
                <Plus aria-hidden className="size-4" />
                Add your first field
              </Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell title="Journal">
      <div className="mx-auto max-w-[52rem] space-y-4">
        {visible.length > 1 ? (
          <FieldPicker fields={visible} activeId={activeId} onSelect={setActiveId} />
        ) : null}
        {active ? <SeasonJournal key={active.id} field={active} uid={uid} /> : null}
      </div>
    </AppShell>
  );
}

function FieldPicker({
  fields,
  activeId,
  onSelect,
}: {
  fields: Field[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="p-3">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate">Field</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {fields.map((field) => (
          <button
            key={field.id}
            type="button"
            aria-pressed={field.id === activeId}
            onClick={() => onSelect(field.id)}
            className={cn(
              "min-h-[44px] rounded-control border px-3 text-sm font-semibold",
              field.id === activeId
                ? "border-forest bg-forest text-white"
                : "border-mist bg-card text-ink",
            )}
          >
            {field.name}
          </button>
        ))}
      </div>
    </Card>
  );
}

function SeasonJournal({ field, uid }: { field: Field; uid: string | null }) {
  const seasonsQuery = useApiQuery(
    // Field id and version in the key, so a slow response for one field can
    // never render under another field's heading.
    [uid, "seasons", field.id, field.version],
    (signal) => fieldsApi.seasons(field.id, { signal, limit: 20 }),
    { enabled: Boolean(uid) },
  );

  const seasons = seasonsQuery.data?.items ?? [];
  const open = seasons.filter((s) => s.status !== "closed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const season = open.find((s) => s.id === selectedId) ?? open[0] ?? null;

  if (seasonsQuery.isLoading) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-32 w-full rounded-card" />
      </div>
    );
  }

  if (seasonsQuery.error) {
    return (
      <ErrorState
        title="Could not load this field's seasons"
        message={seasonsQuery.error.message}
        retryLabel="Try again"
        onRetry={seasonsQuery.error.retryable ? seasonsQuery.refetch : undefined}
      />
    );
  }

  if (!season) return <NoSeason field={field} />;

  return (
    <>
      {open.length > 1 ? (
        <Card className="p-3">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate">Season</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {open.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === season.id}
                onClick={() => setSelectedId(option.id)}
                className={cn(
                  "min-h-[44px] rounded-control border px-3 text-sm font-semibold",
                  option.id === season.id
                    ? "border-forest bg-forest text-white"
                    : "border-mist bg-card text-ink",
                )}
              >
                {option.crop_id} · {option.status}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <SeasonEntries field={field} season={season} uid={uid} />
    </>
  );
}

function SeasonEntries({
  field,
  season,
  uid,
}: {
  field: Field;
  season: Season;
  uid: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [filters, setFilters] = useState<ReadonlySet<JournalAction>>(new Set());

  const journalQuery = useApiQuery(
    [uid, "journal", season.id, season.version],
    (signal) => seasonsApi.journal(season.id, { signal, limit: 100 }),
    { enabled: Boolean(uid) },
  );

  function toggleFilter(action: JournalAction) {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(action)) next.delete(action);
      else next.add(action);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate">{field.name}</p>
          <p className="mt-0.5 break-all text-h3 font-semibold">{season.crop_id}</p>
          <p className="mt-0.5 text-xs text-slate">
            Crop names need the catalogue, which is not being served yet.
          </p>
        </div>
        {!adding ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            Add entry
          </Button>
        ) : null}
      </Card>

      {adding ? (
        <JournalEntryForm
          seasonId={season.id}
          onSaved={() => {
            setAdding(false);
            journalQuery.refetch();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      <JournalTimeline
        entries={journalQuery.data?.items ?? []}
        field={field}
        season={season}
        loading={journalQuery.isLoading}
        error={journalQuery.error}
        onRetry={journalQuery.refetch}
        activeFilters={filters}
        onToggleFilter={toggleFilter}
        onClearFilters={() => setFilters(new Set())}
      />
    </div>
  );
}

/**
 * The state a new account actually lands in.
 *
 * Adding a crop needs a `crop_id` from `/catalog/crops`, which answers 503
 * DEPENDENCY_UNAVAILABLE while nothing builds the Phase 2 reference bundle. So
 * this says so plainly and offers no button — a control that fails when tapped
 * is worse than an explained absence.
 */
function NoSeason({ field }: { field: Field }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate">{field.name}</p>
      <h2 className="mt-1 text-h2 font-semibold">No season to record against</h2>
      <p className="mt-2 text-sm text-slate">
        A journal belongs to a crop season, so that watering, sprays and what you notice all sit
        against the crop they happened to. This field has no crop set, so there is nothing to
        record against yet.
      </p>

      <Callout tone="caution" className="mt-4" title="Adding a crop is not possible yet">
        <p>
          Choosing a crop needs the crop catalogue, and that service is not being served right
          now. This is a problem on our side, not something you have done.
        </p>
        <p className="mt-2">
          Your field is saved. Once the catalogue is available you can set the crop and start the
          journal.
        </p>
      </Callout>
    </Card>
  );
}
