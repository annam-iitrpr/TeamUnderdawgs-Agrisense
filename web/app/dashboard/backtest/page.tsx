"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { Button, Card, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError, type FieldRecord } from "@/lib/api";
import { formatShortDay } from "@/lib/utils";
import { AlertTriangle, Play } from "lucide-react";
import { useEffect, useState } from "react";

type BacktestCall = {
  as_of: string;
  would_have_flagged: boolean;
  stress_type: string | null;
  onset_date: string | null;
  peak_observed: number;
};

type BacktestResult = {
  calls: BacktestCall[];
  summary: {
    windows_evaluated: number;
    windows_flagged: number;
    days_of_history: number;
  };
  provenance: { source: string; live: boolean; note: string | null }[];
  is_fixture: boolean;
  season_start: string;
  season_end: string;
};

export default function BacktestPage() {
  const [fields, setFields] = useState<FieldRecord[] | null>(null);
  const [fieldId, setFieldId] = useState<number | null>(null);
  const [season, setSeason] = useState("2024");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fields()
      .then((r) => {
        setFields(r.items);
        setFieldId(r.items[0]?.id ?? null);
      })
      .catch(() => setFields([]));
  }, []);

  async function run() {
    if (!fieldId) return;
    setRunning(true);
    setError(null);
    try {
      const res = (await api.backtest({
        field_id: fieldId,
        season_start: `${season}-06-01`,
        season_end: `${season}-10-31`,
      })) as unknown as BacktestResult;
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The backtest could not run.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <DashboardShell
      title="Historical backtest"
      subtitle="Run the engine against a past season and see where it would have called a window."
    >
      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="bt-field" className="text-xs font-semibold uppercase tracking-wide text-slate">
                Field
              </label>
              {fields === null ? (
                <Skeleton className="mt-1.5 h-11 w-full" />
              ) : (
                <select
                  id="bt-field"
                  value={fieldId ?? ""}
                  onChange={(e) => setFieldId(Number(e.target.value))}
                  className="mt-1.5 h-11 w-full rounded-control border border-mist bg-card px-3 text-sm"
                >
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.crop})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="w-[10rem]">
              <label htmlFor="bt-season" className="text-xs font-semibold uppercase tracking-wide text-slate">
                Season
              </label>
              <select
                id="bt-season"
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-control border border-mist bg-card px-3 text-sm"
              >
                {["2024", "2023", "2022"].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <Button onClick={run} disabled={running || !fieldId} className="h-11">
              <Play aria-hidden className="size-4" />
              {running ? "Running" : "Run backtest"}
            </Button>
          </div>
        </Card>

        {error ? (
          <ErrorState title="Something went wrong" message={error} onRetry={run} />
        ) : null}

        {running ? <Skeleton className="h-[16rem] rounded-card" /> : null}

        {result && !running ? (
          <>
            {result.is_fixture ? (
              <div className="flex items-start gap-2.5 rounded-card border border-amber bg-[color-mix(in_srgb,var(--amber)_9%,var(--card))] p-3.5">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber" />
                <p className="text-sm">
                  <span className="font-semibold">This is a pre-computed example.</span>{" "}
                  No meteoblue key is configured, so the engine could not fetch real
                  historical weather. With a key this screen runs against the real
                  season.
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Windows evaluated", result.summary.windows_evaluated],
                ["Windows flagged", result.summary.windows_flagged],
                ["Days of history", result.summary.days_of_history],
              ].map(([label, value]) => (
                <Card key={String(label)} className="p-4">
                  <p className="text-xs uppercase tracking-wide text-slate">{label}</p>
                  <p className="score-value mt-1 text-h1 font-semibold">{value}</p>
                </Card>
              ))}
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Each evaluation point in the season and whether the engine would
                    have called a window.
                  </caption>
                  <thead>
                    <tr className="border-b border-mist text-left">
                      {["Standing at", "Called a window", "Stress", "Onset", "Peak observed"].map(
                        (h) => (
                          <th
                            key={h}
                            scope="col"
                            className="p-2.5 text-xs font-semibold uppercase tracking-wide text-slate"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {result.calls.map((c, i) => (
                      <tr key={i} className="border-b border-mist last:border-0">
                        <td className="p-2.5 tabular">{formatShortDay(c.as_of)}</td>
                        <td className="p-2.5">
                          <span
                            className="font-semibold"
                            style={{
                              color: c.would_have_flagged
                                ? "var(--forest)"
                                : "var(--slate)",
                            }}
                          >
                            {c.would_have_flagged ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="p-2.5 capitalize">
                          {c.stress_type?.replace(/_/g, " ") ?? "none"}
                        </td>
                        <td className="p-2.5 tabular">
                          {c.onset_date ? formatShortDay(c.onset_date) : "not applicable"}
                        </td>
                        <td className="p-2.5 tabular">{c.peak_observed.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold">Provenance</h2>
              <ul className="mt-2 space-y-1.5">
                {result.provenance.map((p, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-semibold">{p.source}</span>
                    <span className="text-slate">
                      {p.live ? " (live)" : " (fixture)"}
                      {p.note ? ` ${p.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        ) : null}

        {!result && !running && !error ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-slate">
              Pick a field and a season, then run the backtest to see where the
              engine would have called a window.
            </p>
          </Card>
        ) : null}
      </div>
    </DashboardShell>
  );
}
