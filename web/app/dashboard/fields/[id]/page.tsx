"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import {
  api,
  ApiError,
  type HoursResponse,
  type ProjectionResponse,
  type ScoreResponse,
} from "@/lib/api";
import { stressLabel } from "@/lib/i18n";
import {
  formatHour,
  formatRupees,
  formatShortDay,
  stressToken,
  stressWord,
  titleCase,
} from "@/lib/utils";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const SERIES = ["heat_diurnal", "heat_nocturnal", "frost", "drought"] as const;
const COLORS = ["var(--clay)", "var(--navy)", "var(--amber)", "var(--sprout)"];

export default function FieldDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [projection, setProjection] = useState<ProjectionResponse | null>(null);
  const [hours, setHours] = useState<HoursResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.score(id), api.projection(id), api.hours(id)])
      .then(([s, p, h]) => {
        setScore(s);
        setProjection(p);
        setHours(h);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "We could not load this field."),
      );
  }, [id]);

  useEffect(load, [load]);

  if (error) {
    return (
      <DashboardShell title="Field detail">
        <ErrorState title="Something went wrong" message={error} onRetry={load} />
      </DashboardShell>
    );
  }

  if (!score || !projection || !hours) {
    return (
      <DashboardShell title="Field detail">
        <div className="space-y-5" aria-busy="true">
          <Skeleton className="h-[7rem] rounded-card" />
          <Skeleton className="h-[20rem] rounded-card" />
        </div>
      </DashboardShell>
    );
  }

  const chartData = projection.days.map((d) => {
    const row: Record<string, string | number | null> = {
      date: formatShortDay(d.date),
    };
    for (const s of SERIES) row[s] = d.scores[s];
    return row;
  });

  const active = SERIES.filter((s) => !projection.not_applicable.includes(s));
  const rejected = hours.hours.filter((h) => !h.viable);
  const byRule = rejected.reduce<Record<string, number>>((acc, h) => {
    const key = h.rejection_rule ?? "other";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <DashboardShell
      title={score.field.name}
      subtitle={`${titleCase(score.field.crop)}, ${score.field.area_ha.toFixed(2)} ha, sown ${formatShortDay(score.field.sowing_date)}, at ${score.stage.replace(/_/g, " ")}`}
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate">Readiness</p>
            <p className="score-value mt-1 text-h1 font-semibold">
              {score.readiness_score}
            </p>
          </Card>
          {[
            ["Need", score.need],
            ["Timing fit", score.timing_fit],
            ["Viability", score.viability],
          ].map(([label, value]) => (
            <Card key={String(label)} className="p-4">
              <p className="text-xs uppercase tracking-wide text-slate">{label}</p>
              <p className="score-value mt-1 text-h1 font-semibold">
                {(Number(value) * 100).toFixed(0)}
              </p>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <h2 className="text-h3 font-semibold tracking-tight">
            Every stress type across 14 days
          </h2>
          <div className="mt-3 h-[19rem] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
                <CartesianGrid stroke="var(--mist)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "var(--slate)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--mist)" }}
                />
                <YAxis
                  domain={[0, 9]}
                  ticks={[0, 3, 6, 9]}
                  tick={{ fontSize: 11, fill: "var(--slate)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <ReferenceLine
                  y={projection.onset_threshold}
                  stroke="var(--amber)"
                  strokeDasharray="4 4"
                />
                {active.map((s, i) => (
                  <Line
                    key={s}
                    type="monotone"
                    dataKey={s}
                    name={stressLabel("en", s)}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--mist)",
                    fontSize: 13,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {projection.not_applicable.length > 0 ? (
            <p className="mt-2 border-t border-mist pt-2 text-xs text-slate">
              {projection.not_applicable.map((s) => stressLabel("en", s)).join(", ")}
              {": not applicable for this crop. The source document records these as NA, which is not the same as no risk."}
            </p>
          ) : null}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="text-h3 font-semibold tracking-tight">
              Hour rejections
            </h2>
            <p className="mt-0.5 text-xs text-slate">
              {rejected.length} of {hours.hours.length} hours were ruled out.
            </p>
            <ul className="mt-3 space-y-2">
              {Object.entries(byRule)
                .sort((a, b) => b[1] - a[1])
                .map(([rule, count]) => (
                  <li key={rule} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-2 text-sm">
                    <span className="truncate">{titleCase(rule)}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-mist">
                      <span
                        className="block h-full rounded-full bg-clay"
                        style={{ width: `${(count / hours.hours.length) * 100}%` }}
                      />
                    </span>
                    <span className="tabular text-right text-xs">{count}</span>
                  </li>
                ))}
            </ul>
          </Card>

          <Card className="p-4">
            <h2 className="text-h3 font-semibold tracking-tight">
              The complete input set
            </h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              {[
                ["Crop", titleCase(score.field.crop)],
                ["Growth stage", score.stage.replace(/_/g, " ")],
                ["GDD since sowing", score.gdd_since_sowing.toFixed(1)],
                ["Soil pH", `${score.field.soil_ph} (${score.field.soil_ph_source})`],
                ["Area", `${score.field.area_ha.toFixed(2)} ha`],
                ["Coordinates", `${score.field.lat}, ${score.field.lon}`],
                ["Product selected", titleCase(score.product_kind)],
                [
                  "Season yield risk",
                  score.season_yield_risk === null
                    ? "not computed"
                    : score.season_yield_risk.toFixed(2),
                ],
                [
                  "Driving stress",
                  score.driving_stress ? stressLabel("en", score.driving_stress) : "none",
                ],
                [
                  "Value estimate",
                  score.value_estimate
                    ? `${formatRupees(score.value_estimate.low_inr)} to ${formatRupees(score.value_estimate.high_inr)} (model estimate)`
                    : "not applicable",
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-mist pb-1.5 last:border-0">
                  <dt className="text-slate">{k}</dt>
                  <dd className="tabular text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <Card className="p-4">
          <h2 className="text-h3 font-semibold tracking-tight">
            Provenance of every data point
          </h2>
          <ul className="mt-3 space-y-2">
            {score.provenance.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span
                  aria-hidden
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: p.live ? "var(--sprout)" : "var(--amber)" }}
                />
                <span>
                  <span className="font-semibold">{p.source}</span>
                  <span className="text-slate">
                    {p.live ? " (live)" : " (fixture)"}
                    {p.note ? ` ${p.note}` : ""}
                  </span>
                  <span className="block text-xs text-slate">
                    Fetched {new Date(p.fetched_at).toLocaleString("en-IN")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </DashboardShell>
  );
}
