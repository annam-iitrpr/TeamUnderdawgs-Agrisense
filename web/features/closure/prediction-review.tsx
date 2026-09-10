"use client";

/**
 * Forecast against actual, after the season is closed.
 *
 * This screen exists to let a farmer judge whether to trust the app, so it must
 * not be built to flatter it. Three rules follow from that:
 *
 *  - Metrics come from the server and are shown whatever they say. There is no
 *    filtering of unflattering ones and no "accuracy" figure assembled here out
 *    of parts the server did not combine.
 *  - `denominator_policy` is always shown. A percentage error over an unstated
 *    denominator is not comparable to anything, and two metrics with different
 *    policies cannot be read side by side.
 *  - A metric the server could not compute says so and names its reason. It is
 *    never dropped, because a missing metric quietly disappearing looks like a
 *    metric that passed.
 */
import { Callout, Card, UnknownValue } from "@/components/ui";
import type { ErrorMetric, SeasonClosure, SeasonEvaluation } from "@/lib/api/contract";
import { cn } from "@/lib/utils";
import { CircleHelp, TrendingDown, TrendingUp } from "lucide-react";

const IST = "Asia/Kolkata";

function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function humanise(code: string): string {
  return code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function PredictionReview({
  evaluation,
  cropName,
}: {
  evaluation: SeasonEvaluation;
  cropName: string;
}) {
  const closure = evaluation.closure ?? null;
  const metrics = evaluation.metrics ?? [];

  return (
    <div className="space-y-4">
      {closure ? <Outcome closure={closure} cropName={cropName} /> : null}

      <Card className="p-4">
        <p className="text-sm font-semibold text-ink">How good was the advice?</p>
        <p className="mt-0.5 text-xs text-slate">
          Your season measured against what AgriSense predicted for it. Shown whatever it says
          — this is how you decide whether to trust it next season.
        </p>

        {metrics.length === 0 ? (
          <p className="mt-3 text-sm text-slate">
            No comparison is available for this season. Scoring a forecast needs both the
            forecast that was issued at the time and your closing figures; if the season was
            never evaluated while it ran, there is nothing to compare against.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-mist">
            {metrics.map((metric) => (
              <MetricRow key={`${metric.name}-${metric.denominator_policy}`} metric={metric} />
            ))}
          </ul>
        )}
      </Card>

      {evaluation.warnings && evaluation.warnings.length > 0 ? (
        <Callout tone="caution" title="Read these alongside the figures above">
          <ul className="space-y-0.5">
            {evaluation.warnings.map((warning) => (
              <li key={warning}>{humanise(warning)}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </div>
  );
}

function Outcome({ closure, cropName }: { closure: SeasonClosure; cropName: string }) {
  const perHectare =
    closure.harvested_area_ha > 0
      ? closure.harvest_quantity_kg / closure.harvested_area_ha
      : null;
  const loss = closure.actual_margin_inr < 0;

  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate">
        {cropName} · closed{" "}
        {new Date(closure.confirmed_at).toLocaleDateString("en-IN", { timeZone: IST })}
      </p>

      <p
        className={cn(
          "mt-1 flex items-center gap-2 text-h2 font-semibold",
          loss ? "text-clay" : "text-forest",
        )}
      >
        {loss ? (
          <TrendingDown aria-hidden className="size-5 shrink-0" />
        ) : (
          <TrendingUp aria-hidden className="size-5 shrink-0" />
        )}
        {rupees(closure.actual_margin_inr)}
      </p>
      <p className="mt-0.5 text-sm text-slate">
        {loss ? "Your loss on this season" : "Your margin on this season"} —{" "}
        {rupees(closure.realized_sales_inr)} sold less {rupees(closure.realized_costs_inr)}{" "}
        spent. These are your own figures, not an estimate.
      </p>

      <dl className="mt-4 grid gap-3 border-t border-mist pt-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate">Harvested</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {closure.harvest_quantity_kg.toLocaleString("en-IN")} kg
            <span className="block text-xs font-normal text-slate">
              {closure.product_form.replace(/_/g, " ")}, {closure.moisture_basis.replace(/_/g, " ")}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Yield</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {perHectare != null ? (
              <>
                {Math.round(perHectare).toLocaleString("en-IN")} kg/ha
                <span className="block text-xs font-normal text-slate">
                  over {closure.harvested_area_ha} ha
                </span>
              </>
            ) : (
              <UnknownValue label="Not known" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Harvested on</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {new Date(`${closure.harvested_on}T00:00:00Z`).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            })}
          </dd>
        </div>
      </dl>

      {/* Which forecasts this outcome is scored against. Naming the count
          matters: nought means the season ran without ever being evaluated, so
          no comparison is possible and that is not the farmer's fault. */}
      <p className="mt-3 text-xs text-slate">
        {closure.forecast_snapshot_ids && closure.forecast_snapshot_ids.length > 0
          ? `Scored against ${closure.forecast_snapshot_ids.length} forecast${
              closure.forecast_snapshot_ids.length === 1 ? "" : "s"
            } issued while the season ran.`
          : "No forecast was on record for this season while it ran, so there is nothing to score it against."}
      </p>
    </Card>
  );
}

function MetricRow({ metric }: { metric: ErrorMetric }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2.5">
      <span className="min-w-0">
        <span className="text-sm text-ink">{humanise(metric.name)}</span>
        {/* Never omitted: two metrics with different denominator policies are
            not comparable, and the reader cannot tell without being told. */}
        <span className="block text-xs text-slate">
          counted over {metric.denominator_policy.replace(/_/g, " ")}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {metric.value != null ? (
          <span className="font-semibold tabular-nums text-ink">
            {Number.isInteger(metric.value) ? metric.value : metric.value.toFixed(2)}{" "}
            <span className="text-xs font-normal text-slate">{metric.unit}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-slate">
            <CircleHelp aria-hidden className="size-3.5 shrink-0" />
            <span className="text-sm">
              {metric.missing_reason ? humanise(metric.missing_reason) : "Not known"}
            </span>
          </span>
        )}
      </span>
    </li>
  );
}
