"use client";

/**
 * What to spray on this crop, when, and why.
 *
 * One panel per crop, because a farmer with rice on one plot and maize on
 * another is being told about two different products for two different reasons,
 * and a single merged card would leave them guessing which applied where.
 *
 * The one thing this deliberately does NOT show is how much stress a spray
 * would remove. No such figure exists: nobody has published a stress reduction
 * for these products on these crops, and inventing one is exactly the number a
 * farmer would spend money against. So the panel states the two things that are
 * knowable -- how well the product matches the crop, its stage and the stress
 * actually forecast, and how confident that match is -- and leaves the effect
 * unclaimed. `fit` and `confidence` are honest; "reduces stress by 30%" is not.
 */
import { Card } from "@/components/ui";
import type { Recommendation } from "@/lib/api/contract";
import { explainCode } from "@/lib/missing-reasons";
import { AlertTriangle, CheckCircle2, Clock, Info, Sprout, Wind } from "lucide-react";

/** What each product is positioned for, from the reviewed reference bundle. */
const PURPOSE: Record<string, string> = {
  quantis: "Abiotic stress: heat and drought",
  isabion: "Amino acid support: vigour and recovery",
  coucal: "Soil and root zone: nutrient use and rooting",
};

const PRODUCT_NAME: Record<string, string> = {
  quantis: "QUANTIS",
  isabion: "ISABION",
  coucal: "COUCAL",
};

const STRESS_WORDS: Record<string, string> = {
  day_heat: "daytime heat",
  night_heat: "night heat",
  frost: "frost",
};

function istTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

/** The stress that is actually driving this, with the day it becomes persistent. */
function drivers(recommendation: Recommendation): { kind: string; onset: string | null }[] {
  const peaks = new Map<string, number>();
  for (const point of recommendation.stress_curve ?? []) {
    if (point.value == null) continue;
    const seen = peaks.get(point.stress_type);
    if (seen == null || point.value > seen) peaks.set(point.stress_type, point.value);
  }
  return [...peaks.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind]) => ({
      kind,
      onset:
        (recommendation.stress_onsets ?? []).find((row) => row.stress_type === kind)
          ?.local_date ?? null,
    }));
}

export function BiostimulantPanel({
  cropName,
  recommendation,
}: {
  cropName: string;
  recommendation: Recommendation;
}) {
  const productId = recommendation.product_id;
  const fit = recommendation.product_fit;
  const window = recommendation.selected_window;
  const stress = drivers(recommendation);
  const alternatives = recommendation.alternative_windows ?? [];
  const readiness = recommendation.readiness;

  return (
    <Card as="section" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate">Biostimulant</p>
          <h3 className="text-h3 font-semibold text-ink">
            <span translate="no">{cropName}</span>
          </h3>
        </div>
        {productId ? (
          <span className="shrink-0 rounded-full bg-forest/10 px-2.5 py-1 text-xs font-semibold text-forest">
            <span translate="no">{PRODUCT_NAME[productId] ?? productId}</span>
          </span>
        ) : null}
      </div>

      {productId ? (
        <p className="mt-1 text-sm text-slate">{PURPOSE[productId] ?? "Reviewed product record"}</p>
      ) : null}

      {/* Why. The stress the forecast actually shows, not a generic reason. */}
      {stress.length > 0 ? (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate">
            <AlertTriangle aria-hidden className="size-3.5" /> Why now
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-ink">
            {stress.map(({ kind, onset }) => (
              <li key={kind}>
                {STRESS_WORDS[kind] ?? kind.replace(/_/g, " ")} forecast on this field
                {onset ? (
                  <>
                    , persistent from{" "}
                    <span translate="no">
                      {new Date(onset).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        timeZone: "Asia/Kolkata",
                      })}
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* When. */}
      <div className="mt-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate">
          <Clock aria-hidden className="size-3.5" /> When to spray
        </p>
        {window ? (
          <>
            <p className="mt-0.5 text-sm font-semibold text-ink" translate="no">
              {istTime(window.start_at)} – {istTime(window.end_at)}
            </p>
            {alternatives.length > 0 ? (
              <p className="text-xs text-slate">
                {alternatives.length} other suitable window
                {alternatives.length === 1 ? "" : "s"} this week
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-0.5 text-sm text-ink">
            No safe window in the forecast. Wait rather than spray into these conditions.
          </p>
        )}
      </div>

      {/* Fit and confidence. Never an effect size. */}
      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-mist pt-3 text-sm">
        <div>
          <dt className="text-xs text-slate">Need</dt>
          <dd className="font-semibold tabular-nums text-ink" translate="no">
            {recommendation.need != null ? `${Math.round(recommendation.need * 100)}%` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Timing fit</dt>
          <dd className="font-semibold tabular-nums text-ink" translate="no">
            {recommendation.timing_fit != null
              ? `${Math.round(recommendation.timing_fit * 100)}%`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Readiness</dt>
          <dd className="font-semibold tabular-nums text-ink" translate="no">
            {readiness != null ? `${Math.round(readiness)}/100` : "—"}
          </dd>
        </div>
      </dl>

      {fit && fit.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-slate">
          {fit.reasons.map((reason) => (
            <li key={reason.code} className="flex items-start gap-1.5">
              {fit.eligible ? (
                <CheckCircle2 aria-hidden className="mt-0.5 size-3 shrink-0 text-forest" />
              ) : (
                <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
              )}
              <span>{explainCode(reason.code)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 flex items-start gap-1.5 rounded-control bg-mist/40 px-2.5 py-2 text-xs text-slate">
        <Wind aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          The window is chosen on wind, gust, temperature, humidity and rain, so the spray stays
          on this field. AgriSense does not estimate how much stress a spray removes — no
          published figure exists for these products on this crop, so the match and its timing
          are what it reports. Read the product label before applying.
        </span>
      </p>

      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate">
        <Sprout aria-hidden className="size-3.5" />
        Stage: <span translate="no">{recommendation.stage?.replace(/_/g, " ") ?? "not set"}</span>
      </p>
    </Card>
  );
}
