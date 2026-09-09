"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { StressMap } from "@/components/stress-map";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError, type DashboardResponse, type DashboardRow } from "@/lib/api";
import { cn, formatHour, stressToken, stressWord, titleCase } from "@/lib/utils";
import { ArrowUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type SortKey = "field_name" | "crop" | "stress_level" | "readiness_score";

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "stress_level",
    dir: -1,
  });

  const load = useCallback(() => {
    setError(null);
    api
      .dashboard()
      .then(setData)
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : "We could not load the dashboard.",
        ),
      );
  }, []);

  useEffect(load, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * sort.dir;
      }
      return ((av as number) - (bv as number)) * sort.dir;
    });
  }, [data, sort]);

  if (error) {
    return (
      <DashboardShell title="Field overview">
        <ErrorState title="Something went wrong" message={error} onRetry={load} />
      </DashboardShell>
    );
  }

  if (!data) {
    return (
      <DashboardShell title="Field overview">
        <div className="space-y-5" aria-busy="true">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[5.5rem] rounded-card" />
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <Skeleton className="h-[24rem] rounded-card" />
            <Skeleton className="h-[24rem] rounded-card" />
          </div>
        </div>
      </DashboardShell>
    );
  }

  const stats = [
    { label: "Fields monitored", value: data.stats.fields_monitored },
    { label: "Fields with an open window", value: data.stats.open_windows },
    { label: "Adherence rate", value: `${data.stats.adherence_rate}%` },
    { label: "Journal entries this season", value: data.stats.journal_entries },
  ];

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  return (
    <DashboardShell
      title="Field overview"
      subtitle={`${data.rows.length} fields scored against the live forecast.`}
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate">
                {s.label}
              </p>
              <p className="score-value mt-1.5 text-h1 font-semibold tracking-tight">
                {s.value}
              </p>
            </Card>
          ))}
        </div>

        {data.rows.length === 0 ? (
          <EmptyState
            title="No fields yet"
            message="Once a farmer completes onboarding, their field appears here."
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <StressMap
              rows={data.rows}
              onSelect={(id) => router.push(`/dashboard/fields/${id}`)}
            />

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Monitored fields with stress level, recommended window and
                    adherence.
                  </caption>
                  <thead>
                    <tr className="border-b border-mist text-left">
                      {(
                        [
                          ["field_name", "Field"],
                          ["crop", "Crop"],
                          ["stress_level", "Stress"],
                          ["readiness_score", "Readiness"],
                        ] as [SortKey, string][]
                      ).map(([key, label]) => (
                        <th key={key} scope="col" className="p-2.5">
                          <button
                            onClick={() => toggleSort(key)}
                            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate"
                            aria-label={`Sort by ${label}`}
                          >
                            {label}
                            <ArrowUpDown aria-hidden className="size-3" />
                          </button>
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="p-2.5 text-xs font-semibold uppercase tracking-wide text-slate"
                      >
                        Window
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.field_id}
                        onClick={() => router.push(`/dashboard/fields/${row.field_id}`)}
                        className="cursor-pointer border-b border-mist last:border-0 hover:bg-[color-mix(in_srgb,var(--mist)_40%,transparent)]"
                      >
                        <td className="p-2.5">
                          <p className="font-semibold">{row.field_name}</p>
                          <p className="text-xs text-slate">
                            {row.farmer_name}, {row.village}
                          </p>
                        </td>
                        <td className="p-2.5 capitalize">{row.crop}</td>
                        <td className="p-2.5">
                          <span className="flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: stressToken(row.stress_level) }}
                            />
                            <span className="tabular font-semibold">
                              {row.stress_level.toFixed(1)}
                            </span>
                            <span className="text-xs text-slate">
                              {stressWord(row.stress_level)}
                            </span>
                          </span>
                        </td>
                        <td className="p-2.5 tabular font-semibold">
                          {row.readiness_score}
                        </td>
                        <td className="p-2.5">
                          {row.actionable && row.window_start ? (
                            <span className="tabular text-xs font-semibold text-forest">
                              {formatHour(row.window_start)} to{" "}
                              {formatHour(row.window_end!)}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-clay">
                              Wait
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Adherence by field</h2>
          <ul className="mt-3 space-y-2">
            {data.rows.map((row) => (
              <li
                key={row.field_id}
                className="grid grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)_auto] items-center gap-3 text-sm"
              >
                <span className="truncate">{row.field_name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-mist">
                  <span
                    className="block h-full rounded-full bg-navy"
                    style={{
                      width: `${row.journal_entries ? Math.min((row.sprays_logged / row.journal_entries) * 100, 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="tabular text-xs text-slate">
                  {row.sprays_logged} of {row.journal_entries} logged
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <ProvenanceNote data={data} />
      </div>
    </DashboardShell>
  );
}

function ProvenanceNote({ data }: { data: DashboardResponse }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">Where these numbers came from</h2>
      <ul className="mt-2 space-y-1.5">
        {data.provenance.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span
              aria-hidden
              className="mt-1 size-2 shrink-0 rounded-full"
              style={{ backgroundColor: p.live ? "var(--sprout)" : "var(--amber)" }}
            />
            <span>
              <span className="font-semibold">{p.source}</span>
              <span className="text-slate">
                {p.live ? " (live)" : " (fixture)"}
                {p.note ? ` ${p.note}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
