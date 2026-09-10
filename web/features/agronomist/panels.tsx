"use client";

import { Callout, Card, EmptyState, ErrorState, Skeleton, UnknownValue } from "@/components/ui";
import { ApiError } from "@/lib/api/envelope";
import { useApiQuery } from "@/lib/api/query";
import { agronomist } from "@/lib/api/routes";
import type { Field } from "@/lib/api/contract";
import { formatArea } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  isValidatedServing,
  narrowEvidence,
  narrowModels,
  type NarrowedSummary,
} from "./narrow";
import { useMemo, useState } from "react";

/* ───────────────────────────────────────────────────────────── summary */

/**
 * Summary tiles.
 *
 * `AgronomistSummary` carries four counts and a status breakdown. It carries
 * **no time window**, so this screen states that rather than captioning the
 * figures "last 30 days" — a window nobody supplied would be invented, and an
 * invented window makes every number here unfalsifiable.
 *
 * Every proportion is rendered as "n of N", so the denominator is always on
 * screen. A bare percentage is not interpretable and the spec disallows it.
 */
export function SummaryTiles({
  summary,
  dataMode,
}: {
  summary: NarrowedSummary | null;
  dataMode: string | null;
}) {
  if (!summary) {
    return (
      <Callout tone="caution" title="Summary could not be read">
        The server answered, but the response did not match the expected summary shape, so no
        figures are shown.
      </Callout>
    );
  }

  const statuses = Object.entries(summary.recommendationStatusCounts).sort(
    (a, b) => b[1] - a[1],
  );
  const statusTotal = statuses.reduce((sum, [, count]) => sum + count, 0);

  return (
    <section aria-labelledby="summary-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="summary-heading" className="text-h3 font-semibold">
          Assigned portfolio
        </h2>
        {dataMode ? (
          <span className="text-xs text-slate">
            Data mode: <span className="font-semibold">{dataMode}</span>
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <CountTile label="Farmers assigned" value={summary.assignedFarmerCount} />
        <CountTile label="Fields" value={summary.fieldCount} />
        <CountTile label="Active seasons" value={summary.activeSeasonCount} />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Recommendation status</h3>
        {statuses.length === 0 ? (
          <p className="mt-2 text-sm text-slate">
            No recommendations have been issued across the assigned fields yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {statuses.map(([status, count]) => (
              <li
                key={status}
                className="grid grid-cols-[10rem_1fr_auto] items-center gap-3 text-sm"
              >
                <span className="truncate capitalize">{status.replace(/_/g, " ")}</span>
                <span
                  className="h-2 overflow-hidden rounded-full bg-mist"
                  role="img"
                  aria-label={`${count} of ${statusTotal}`}
                >
                  <span
                    className="block h-full rounded-full bg-sprout"
                    style={{
                      width: statusTotal > 0 ? `${(count / statusTotal) * 100}%` : "0%",
                    }}
                  />
                </span>
                {/* Denominator always visible, never a bare percentage. */}
                <span className="tabular whitespace-nowrap text-xs font-semibold">
                  {count} of {statusTotal}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-mist pt-2 text-xs text-slate">
          These are counts at the moment of this request. The summary carries no time window, so
          no period is claimed for them.
        </p>
      </Card>
    </section>
  );
}

function CountTile({ label, value }: { label: string; value: number | null }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-slate">{label}</p>
      <p className="score-value mt-1 text-h1 font-semibold">
        {value === null ? <UnknownValue label="Not known" /> : value}
      </p>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── fields */

/**
 * Assigned fields.
 *
 * The spec asks for district, crop, season and product filters. The contract's
 * `Field` carries none of those — it has name, area, centroid, irrigation
 * method, soil summary, archived flag and version. Crop and season live on
 * `Season`, which this endpoint does not return, and there is no district at
 * all. So the filters offered here are the ones the data can actually support,
 * and the gap is stated rather than mocked up with controls that filter nothing.
 */
export function FieldsPanel({ uid }: { uid: string | null }) {
  const query = useApiQuery(
    [uid, "agronomist", "fields"],
    (signal) => agronomist.fields({ signal, limit: 100 }),
    { enabled: Boolean(uid) },
  );

  const [search, setSearch] = useState("");
  const [irrigation, setIrrigation] = useState<string>("all");
  const [includeArchived, setIncludeArchived] = useState(false);

  // See money-screen: an inline `?? []` is a new array identity per render, so
  // the option list below would be rebuilt on every keystroke in the search box.
  const items = query.data?.items;
  const all: Field[] = useMemo(() => items ?? [], [items]);

  const irrigationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const field of all) if (field.irrigation_method) set.add(field.irrigation_method);
    return Array.from(set).sort();
  }, [all]);

  const filtered = all.filter((field) => {
    if (!includeArchived && field.archived) return false;
    if (irrigation !== "all" && field.irrigation_method !== irrigation) return false;
    if (search.trim() !== "" && !field.name.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  if (query.isLoading) return <Skeleton className="h-56 w-full rounded-card" />;

  if (query.error) {
    return (
      <ErrorState
        title="Could not load assigned fields"
        message={query.error.message}
        onRetry={query.error.retryable ? query.refetch : undefined}
      />
    );
  }

  return (
    <section aria-labelledby="fields-heading" className="space-y-3">
      <h2 id="fields-heading" className="text-h3 font-semibold">
        Assigned fields
      </h2>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-ink">Search by field name</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 block min-h-[44px] w-full rounded-control border border-mist bg-card px-3 text-sm"
            />
          </label>

          <label>
            <span className="block text-xs font-semibold text-ink">Irrigation</span>
            <select
              value={irrigation}
              onChange={(e) => setIrrigation(e.target.value)}
              className="mt-1 block min-h-[44px] rounded-control border border-mist bg-card px-3 text-sm"
            >
              <option value="all">All</option>
              {irrigationOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="size-4 accent-[var(--forest)]"
            />
            Include archived
          </label>
        </div>

        <p className="mt-2 text-xs text-slate">
          District, crop, season and product filters are not offered because the fields endpoint
          does not carry those attributes — crop and season belong to a season record, and there
          is no district field in the contract.
        </p>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "No fields assigned" : "No fields match these filters"}
          message={
            all.length === 0
              ? "Once farmers are assigned to you, their fields appear here."
              : "Clear the search or the irrigation filter to see more."
          }
        />
      ) : (
        /* Own scroll container: a wide table must never push the page sideways. */
        <div className="overflow-x-auto rounded-card border border-mist">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">
              Assigned fields, {filtered.length} of {all.length} shown
            </caption>
            <thead className="bg-[color-mix(in_srgb,var(--mist)_35%,var(--card))]">
              <tr>
                <Th>Field</Th>
                <Th>Area</Th>
                <Th>Irrigation</Th>
                <Th>Location precision</Th>
                <Th>Soil test</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((field) => (
                <tr key={field.id} className="border-t border-mist">
                  <Td>
                    <span className="font-semibold">{field.name}</span>
                    {field.archived ? (
                      <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-xs">
                        archived
                      </span>
                    ) : null}
                  </Td>
                  <Td>{formatArea(field.area_ha, "ha")}</Td>
                  <Td className="capitalize">
                    {field.irrigation_method ?? <UnknownValue label="Not set" />}
                  </Td>
                  <Td>
                    {/* Source, not coordinates: an overview does not need the
                        farm's position, and printing it would disclose it. */}
                    {field.centroid.source === "gps" ? "GPS" : "approximate"}
                    {field.centroid.precision_m !== null &&
                    field.centroid.precision_m !== undefined ? (
                      <span className="text-slate"> · ±{Math.round(field.centroid.precision_m)} m</span>
                    ) : null}
                  </Td>
                  <Td>
                    {field.soil_summary ? "On record" : <UnknownValue label="None" />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate">
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-top", className)}>{children}</td>;
}

/* ──────────────────────────────────────────────────────────── evidence */

export function EvidencePanel({ uid }: { uid: string | null }) {
  const query = useApiQuery(
    [uid, "agronomist", "evidence"],
    (signal) => agronomist.evidence({ signal, limit: 50 }),
    { enabled: Boolean(uid) },
  );

  if (query.isLoading) return <Skeleton className="h-40 w-full rounded-card" />;
  if (query.error) {
    return (
      <ErrorState
        title="Could not load evidence records"
        message={query.error.message}
        onRetry={query.error.retryable ? query.refetch : undefined}
      />
    );
  }

  const records = narrowEvidence(query.data);

  return (
    <section aria-labelledby="evidence-heading" className="space-y-3">
      <h2 id="evidence-heading" className="text-h3 font-semibold">
        Evidence base
      </h2>
      {records.length === 0 ? (
        <EmptyState
          title="No evidence records"
          message="Reviewed sources behind the agronomic parameters appear here once published."
        />
      ) : (
        <ul className="space-y-2">
          {records.map((record) => (
            <li key={record.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{record.title ?? record.id}</p>
                  {record.kind ? (
                    <span className="rounded-full border border-mist px-2 py-0.5 text-xs capitalize">
                      {record.kind}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate">
                  Source: {record.source ?? "not stated"} · Samples:{" "}
                  {record.sampleCount === null ? "not stated" : record.sampleCount}
                </p>
                {/* Limitations are shown, never collapsed away: a source's
                    caveats are the part an agronomist needs most. */}
                {record.limitations.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-slate">
                    {record.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate">No limitations recorded.</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── models */

/**
 * Model and evaluation status.
 *
 * The one thing this panel must not do is imply a model is trustworthy because
 * nothing errored. `candidate` and `shadow` mean the pipeline runs and is
 * awaiting validation; only `approved` with a recorded approver is serving
 * validated predictions. Those are rendered as visibly different claims, and
 * there is deliberately no promotion control here — promotion is a reviewed
 * action, not a button on a dashboard.
 */
export function ModelsPanel({ uid }: { uid: string | null }) {
  const query = useApiQuery(
    [uid, "agronomist", "models"],
    (signal) => agronomist.models({ signal }),
    { enabled: Boolean(uid) },
  );

  if (query.isLoading) return <Skeleton className="h-40 w-full rounded-card" />;

  if (query.error) {
    const unavailable = query.error instanceof ApiError && query.error.isDependencyUnavailable;
    return (
      <Callout tone={unavailable ? "caution" : "blocked"} title="Model status unavailable">
        <p>{query.error.message}</p>
        <p className="mt-2">
          No model is described as healthy in the absence of an answer — an unknown state is shown
          as unknown.
        </p>
      </Callout>
    );
  }

  const models = narrowModels(query.data);

  return (
    <section aria-labelledby="models-heading" className="space-y-3">
      <h2 id="models-heading" className="text-h3 font-semibold">
        Models and evaluation
      </h2>

      {models.length === 0 ? (
        <Callout tone="info" title="No model versions registered">
          The registry returned no versions. Recommendations are therefore produced by the
          deterministic rules only, not by a trained model.
        </Callout>
      ) : (
        <ul className="space-y-2">
          {models.map((model) => {
            const validated = isValidatedServing(model);
            return (
              <li key={model.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">{model.target ?? model.id}</p>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        validated
                          ? "bg-[color-mix(in_srgb,var(--sprout)_18%,transparent)] text-forest"
                          : "bg-[color-mix(in_srgb,var(--amber)_18%,transparent)] text-amber-ink",
                      )}
                    >
                      {validated ? "Validated, serving" : "Pipeline implemented, awaiting validation"}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate">
                    Registry status: <span className="font-semibold">{model.status}</span>
                    {model.approvedBy ? ` · approved by ${model.approvedBy}` : " · no approver recorded"}
                    {model.approvedAt ? ` · ${model.approvedAt}` : ""}
                  </p>

                  {model.metrics.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {model.metrics.map((metric, index) => (
                        <li key={`${metric.name ?? "metric"}-${index}`} className="text-slate">
                          <span className="font-semibold text-ink">{metric.name ?? "metric"}</span>
                          {": "}
                          {metric.value === null
                            ? `not measured${metric.missingReason ? ` (${metric.missingReason})` : ""}`
                            : `${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`}
                          {/* Denominator policy shown verbatim: a metric
                              without its denominator is not interpretable. */}
                          {metric.denominatorPolicy
                            ? ` · denominator: ${metric.denominatorPolicy}`
                            : " · denominator not stated"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-slate">
                      No metrics recorded, so this version has no measured performance to show.
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
