"use client";

import { PhoneFrame } from "@/components/phone-frame";
import { useApp } from "@/components/providers";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import {
  api,
  ApiError,
  type ProjectionResponse,
  type ScoreResponse,
} from "@/lib/api";
import { stressLabel } from "@/lib/i18n";
import { formatShortDay, stressToken, stressWord } from "@/lib/utils";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const SERIES = ["heat_diurnal", "heat_nocturnal", "frost", "drought"] as const;

export default function WhyPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { t, language } = useApp();

  const [projection, setProjection] = useState<ProjectionResponse | null>(null);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.projection(id), api.score(id, language)])
      .then(([p, s]) => {
        setProjection(p);
        setScore(s);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "We could not load this."),
      );
  }, [id, language]);

  useEffect(load, [load]);

  if (error) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("whyTitle")}>
        <div className="p-4">
          <ErrorState
            title={t("errorTitle")}
            message={error}
            retryLabel={t("retry")}
            onRetry={load}
          />
        </div>
      </PhoneFrame>
    );
  }

  if (!projection || !score) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("whyTitle")}>
        <div className="space-y-4 p-4" aria-busy="true">
          <Skeleton className="h-[15rem] w-full rounded-card" />
          <Skeleton className="h-[9rem] w-full rounded-card" />
        </div>
      </PhoneFrame>
    );
  }

  const active = SERIES.filter(
    (s) => !projection.not_applicable.includes(s) &&
      projection.days.some((d) => d.scores[s] !== null && d.scores[s]! > 0),
  );

  const chartData = projection.days.map((d) => {
    const row: Record<string, string | number | null> = {
      date: formatShortDay(d.date, language),
      raw: d.date,
    };
    for (const s of SERIES) row[s] = d.scores[s];
    return row;
  });

  const onset = Object.values(projection.onsets).sort((a, b) =>
    a.date.localeCompare(b.date),
  )[0];

  const windowStartLabel = score.window
    ? formatShortDay(score.window.start, language)
    : null;

  // A text alternative to the chart, so the screen reader user gets the same
  // information rather than an announcement that a chart exists.
  const summary = active
    .map((s) => {
      const values = projection.days
        .map((d) => d.scores[s])
        .filter((v): v is number => v !== null);
      const peak = Math.max(...values, 0);
      return `${stressLabel(language, s)} peaks at ${peak.toFixed(1)} out of 9, which is ${stressWord(peak).toLowerCase()}`;
    })
    .join(". ");

  return (
    <PhoneFrame backHref={`/field/${id}`} title={t("whyTitle")}>
      <div className="animate-rise space-y-4 p-4">
        <Card className="p-4">
          <h2 className="text-h3 font-semibold tracking-tight">
            {t("stressForecast")}
          </h2>
          <p className="mt-0.5 text-xs text-slate">
            0 means no stress, 9 is the most severe.
          </p>

          <p className="sr-only">
            {summary}. {windowStartLabel ? `The recommended window is on ${windowStartLabel}.` : ""}
          </p>

          <div className="mt-3 h-[15rem] w-full" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 6, right: 6, bottom: 0, left: -26 }}
              >
                <defs>
                  {active.map((s, i) => (
                    <linearGradient
                      key={s}
                      id={`fill-${s}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={SERIES_COLOR[i % SERIES_COLOR.length]}
                        stopOpacity={0.22}
                      />
                      <stop
                        offset="100%"
                        stopColor={SERIES_COLOR[i % SERIES_COLOR.length]}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  ))}
                </defs>

                <CartesianGrid stroke="var(--mist)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "var(--slate)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--mist)" }}
                  interval={2}
                />
                <YAxis
                  domain={[0, 9]}
                  ticks={[0, 3, 6, 9]}
                  tick={{ fontSize: 11, fill: "var(--slate)" }}
                  tickLine={false}
                  axisLine={false}
                />

                {/* The window we are recommending. */}
                {windowStartLabel ? (
                  <ReferenceArea
                    x1={windowStartLabel}
                    x2={windowStartLabel}
                    fill="var(--sprout)"
                    fillOpacity={0.16}
                    stroke="var(--sprout)"
                    strokeOpacity={0.5}
                  />
                ) : null}

                <ReferenceLine
                  y={projection.onset_threshold}
                  stroke="var(--amber)"
                  strokeDasharray="4 4"
                  label={{
                    value: "action level",
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "var(--amber)",
                  }}
                />

                {active.map((s, i) => (
                  <Area
                    key={`a-${s}`}
                    type="monotone"
                    dataKey={s}
                    stroke="none"
                    fill={`url(#fill-${s})`}
                    isAnimationActive={false}
                  />
                ))}
                {active.map((s, i) => (
                  <Line
                    key={`l-${s}`}
                    type="monotone"
                    dataKey={s}
                    stroke={SERIES_COLOR[i % SERIES_COLOR.length]}
                    strokeWidth={2}
                    dot={false}
                    name={stressLabel(language, s)}
                    isAnimationActive={false}
                  />
                ))}

                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--mist)",
                    fontSize: 13,
                  }}
                  formatter={(value: number | string, name: string) => [
                    typeof value === "number" ? value.toFixed(1) : value,
                    name,
                  ]}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {active.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className="h-0.5 w-4 rounded-full"
                  style={{ backgroundColor: SERIES_COLOR[i % SERIES_COLOR.length] }}
                />
                {stressLabel(language, s)}
              </li>
            ))}
          </ul>

          {projection.not_applicable.length > 0 ? (
            <p className="mt-2 border-t border-mist pt-2 text-xs text-slate">
              {projection.not_applicable
                .map((s) => stressLabel(language, s))
                .join(", ")}
              {": "}
              {t("notApplicable")}
            </p>
          ) : null}
        </Card>

        <Card className="p-4">
          <h2 className="text-h3 font-semibold tracking-tight">
            {t("whatDrivesThis")}
          </h2>
          <ul className="mt-2.5 space-y-2.5">
            {score.factors.map((f, i) => (
              <li key={i} className="flex gap-2.5 text-body">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-forest"
                />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </Card>

        {onset ? (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate">
              {t("onsetMarker")}
            </h2>
            <p className="mt-1 flex items-center gap-2">
              <span
                aria-hidden
                className="size-3 rounded-full"
                style={{ backgroundColor: stressToken(onset.value) }}
              />
              <span className="text-h3 font-semibold">
                {stressLabel(language, onset.stress_type)}
              </span>
              <span className="score-value ml-auto text-h3 font-semibold">
                {onset.value.toFixed(1)}
              </span>
            </p>
            <p className="mt-1 text-sm text-slate">
              {formatShortDay(onset.date, language)}, rated {stressWord(onset.value).toLowerCase()}
            </p>
          </Card>
        ) : null}
      </div>
    </PhoneFrame>
  );
}

const SERIES_COLOR = [
  "var(--clay)",
  "var(--navy)",
  "var(--amber)",
  "var(--sprout)",
];
