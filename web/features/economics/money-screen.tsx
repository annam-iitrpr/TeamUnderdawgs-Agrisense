"use client";

/**
 * P1-06 — what this season is expected to be worth, and what it has cost so far.
 *
 * Two different things share this screen and are never mixed. What a farmer has
 * actually spent comes from their own journal entries and is a fact. What the
 * season is expected to return comes from the engine and is a distribution.
 * Adding them together, or showing the forecast as though it were money in
 * hand, would be the most misleading thing this screen could do.
 *
 * A negative margin is shown as a negative margin. Clamping it to a green zero
 * would hide the one number a farmer most needs to see.
 */
import { AppShell } from "@/components/app-shell";
import { Callout, Card, ErrorState, Skeleton, UnknownValue } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { EstimateBand } from "@/features/planning/estimate-band";
import type { Economics, JournalEntry, Season } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/query";
import { seasons as seasonsApi } from "@/lib/api/routes";
import { ChevronDown, IndianRupee, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { WhatIf } from "./what-if";

function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function MoneyScreen({ seasonId }: { seasonId: string }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const seasonQuery = useApiQuery(
    [uid, "season", seasonId],
    (signal) => seasonsApi.get(seasonId, { signal }),
    { enabled: Boolean(uid) },
  );
  const economicsQuery = useApiQuery(
    [uid, "season", seasonId, "economics"],
    (signal) => seasonsApi.economics(seasonId, { signal }),
    { enabled: Boolean(uid) },
  );
  const journalQuery = useApiQuery(
    [uid, "season", seasonId, "journal"],
    (signal) => seasonsApi.journal(seasonId, { signal, limit: 100 }),
    { enabled: Boolean(uid) },
  );

  const season = seasonQuery.data ?? null;
  const economics = economicsQuery.data ?? null;
  // Memoised rather than defaulted inline: a fresh `[]` on every render gives
  // the reductions below a new dependency each time and defeats their memo.
  const journalItems = journalQuery.data?.items;
  const entries: JournalEntry[] = useMemo(() => journalItems ?? [], [journalItems]);

  // Recorded spending is the farmer's own arithmetic on their own entries, so it
  // is a fact rather than an estimate and is labelled that way.
  const spentSoFar = useMemo(
    () => entries.reduce((total, entry) => total + (entry.cost_inr ?? 0), 0),
    [entries],
  );

  return (
    <AppShell title="Money">
      <div className="space-y-4">
        {seasonQuery.isLoading ? (
          <Skeleton className="h-24 w-full rounded-card" />
        ) : season ? (
          <SeasonHeader season={season} />
        ) : null}

        <Card className="p-5">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate">
            <Wallet aria-hidden className="size-3.5" />
            Spent so far
          </p>
          {journalQuery.isLoading ? (
            <Skeleton className="mt-2 h-8 w-32" />
          ) : (
            <>
              <p className="mt-1 text-h1 font-semibold tabular-nums text-ink">
                {rupees(spentSoFar)}
              </p>
              <p className="mt-1 text-sm text-slate">
                {entries.filter((e) => e.cost_inr != null).length} recorded{" "}
                {entries.filter((e) => e.cost_inr != null).length === 1 ? "cost" : "costs"} from
                your journal. This is what you entered, not an estimate.
              </p>
            </>
          )}
          <Link href="/journal" className="mt-2 inline-block text-sm font-semibold text-forest underline">
            Add or check a cost
          </Link>
        </Card>

        {economicsQuery.isLoading ? (
          <Skeleton className="h-64 w-full rounded-card" />
        ) : economicsQuery.error ? (
          <NoEconomics
            message={economicsQuery.error.message}
            dependency={economicsQuery.error.isDependencyUnavailable}
            seasonId={seasonId}
          />
        ) : economics ? (
          <>
            <Forecast economics={economics} spentSoFar={spentSoFar} />
            <WhatIf economics={economics} />
            <Card className="p-4">
              <button
                type="button"
                onClick={() => setAssumptionsOpen((v) => !v)}
                aria-expanded={assumptionsOpen}
                className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-ink"
              >
                What these figures assume
                <ChevronDown
                  aria-hidden
                  className={`size-4 transition-transform ${assumptionsOpen ? "rotate-180" : ""}`}
                />
              </button>
              {assumptionsOpen ? <Assumptions economics={economics} /> : null}
            </Card>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function SeasonHeader({ season }: { season: Season }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate">
        {season.status} season
      </p>
      <p className="mt-0.5 text-h3 font-semibold capitalize text-ink">{season.crop_id}</p>
      <p className="mt-0.5 text-sm text-slate">{season.allocated_area_ha} ha</p>
    </Card>
  );
}

/**
 * The engine's distribution, with the headline the spec asks for.
 *
 * Each component is shown separately rather than only as a bottom line, because
 * a farmer deciding whether to spend more needs to see which side of the
 * calculation is moving.
 */
function Forecast({ economics, spentSoFar }: { economics: Economics; spentSoFar: number }) {
  const forecastCost = economics.cost?.p50 ?? null;
  // Spending already recorded is subtracted from the forecast rather than added
  // to it, so the remainder is what is still expected to be spent.
  const remaining = forecastCost != null ? Math.max(0, forecastCost - spentSoFar) : null;

  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate">
        <IndianRupee aria-hidden className="size-3.5" />
        Estimated net return
      </p>
      <div className="mt-2">
        <EstimateBand estimate={economics.profit} label="" emphasis />
      </div>
      <p className="mt-1 text-sm text-slate">
        The range is what the engine considers likely, not a promise. A loss is shown as a loss.
      </p>

      <dl className="mt-4 grid gap-4 border-t border-mist pt-4 sm:grid-cols-2">
        <EstimateBand estimate={economics.revenue} label="Expected sales" />
        <EstimateBand estimate={economics.cost} label="Expected total cost" />
        <EstimateBand estimate={economics.roi} label="Return on spend" />
        <div>
          <p className="text-xs text-slate">Still expected to spend</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
            {remaining != null ? rupees(remaining) : <UnknownValue label="Not known" />}
          </p>
          {remaining != null ? (
            <p className="text-xs text-slate">Expected total less what you have recorded</p>
          ) : null}
        </div>
      </dl>

      {economics.price?.value != null ? (
        <p className="mt-3 text-xs text-slate">
          Priced at ₹{economics.price.value} per {economics.price.unit}
          {economics.price_date ? ` on ${economics.price_date}` : ""}
          {economics.price_source ? ` · ${economics.price_source}` : ""}
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate">
          No price is recorded for this crop, so sales and return cannot be calculated.
        </p>
      )}
    </Card>
  );
}

function Assumptions({ economics }: { economics: Economics }) {
  const groups: Array<[string, string[]]> = [
    ["Cost", economics.cost?.assumptions ?? []],
    ["Sales", economics.revenue?.assumptions ?? []],
    ["Net return", economics.profit?.assumptions ?? []],
    ["Return on spend", economics.roi?.assumptions ?? []],
  ];
  const any = groups.some(([, list]) => list.length > 0);

  return (
    <div className="mt-3 space-y-3 text-sm">
      {any ? (
        groups.map(([label, list]) =>
          list.length > 0 ? (
            <div key={label}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate">{label}</p>
              <ul className="mt-1 list-inside list-disc text-slate">
                {list.map((item) => (
                  <li key={item}>{item.replace(/_/g, " ")}</li>
                ))}
              </ul>
            </div>
          ) : null,
        )
      ) : (
        <p className="text-slate">
          The engine did not state assumptions for these figures.
        </p>
      )}
    </div>
  );
}

function NoEconomics({
  message,
  dependency,
  seasonId,
}: {
  message: string;
  dependency: boolean;
  seasonId: string;
}) {
  if (!dependency) {
    return <ErrorState title="Could not load the money view" message={message} />;
  }
  return (
    <Callout tone="caution" title="No return estimate for this season yet">
      <p>
        A return estimate needs this season evaluated and reviewed price and cost records for
        your area. AgriSense will not put a rupee figure on a season it cannot support, because
        a made-up number is worse than none when you are deciding what to spend.
      </p>
      <p className="mt-2 text-sm">
        What you have already spent is shown above from your own journal, and stays accurate
        either way.
      </p>
      <Link
        href={`/journal?season=${encodeURIComponent(seasonId)}`}
        className="mt-2 inline-block text-sm font-semibold text-forest underline"
      >
        Record what you have spent
      </Link>
    </Callout>
  );
}
