"use client";

/**
 * Render a contract `Estimate` as the range it is.
 *
 * These are distributions, not figures: showing only p50 would let a farmer
 * plan against a number the engine never promised. The band is shown with its
 * basis, because a scenario estimate and a calibrated one deserve different
 * trust, and an unknown estimate says so with its reason rather than rendering
 * as zero — a zero rupee profit and an unknown profit are different claims.
 */
import { UnknownValue } from "@/components/ui";
import type { Estimate } from "@/lib/api/contract";
import { formatMoney, formatPercent, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { explainCode } from "@/lib/missing-reasons";

/**
 * "Scenario" was too flattering a word for what the planning engine returns.
 * Every whole-season money figure comes back with this basis and an evidence
 * record that calls itself indicative and unreviewed, so the label says so:
 * a farmer reading "Scenario" could take it for a plan made for their field.
 */
const BASIS_LABEL: Record<string, string> = {
  scenario: "Indicative scenario",
  empirically_calibrated: "Calibrated",
  observed: "Observed",
};

/**
 * Rupees read better whole; a rate like ROI keeps one decimal.
 *
 * The grouping is Indian — ₹1,18,500, not ₹118,500 — and comes from the shared
 * money and quantity formatters rather than a second `toLocaleString` call
 * here, so a change to how the app writes rupees reaches every screen at once.
 */
export function formatEstimateValue(value: number, unit: string): string {
  if (unit === "INR") return formatMoney(value);
  if (unit === "%") return formatPercent(value, "en", 1);
  // A bare ratio carries no symbol: appending "ratio" would read as a unit.
  if (unit === "ratio") return value.toFixed(1);
  if (unit === "mm") return formatQuantity(value, unit, "en", 0);
  if (unit === "kg" || unit === "kg/ha") return formatQuantity(value, unit, "en", 0);
  return formatQuantity(value, unit, "en", 1);
}

export function EstimateBand({
  estimate,
  label,
  emphasis,
  className,
  unknownCode,
}: {
  estimate: Estimate | null | undefined;
  label: string;
  emphasis?: boolean;
  className?: string;
  /**
   * What to say when the estimate is absent and carries no reason of its own.
   * A caller that knows why the figure is missing supplies its code; the
   * default admits that nobody said, which is still an answer a farmer can act
   * on. "Not known" on its own was neither.
   */
  unknownCode?: string;
}) {
  if (!estimate || estimate.p50 == null) {
    return (
      <div className={className}>
        <p className="text-xs text-slate">{label}</p>
        <div className="mt-0.5">
          <UnknownValue
            label={explainCode(estimate?.missing_reason ?? unknownCode ?? "figure_not_supplied")}
          />
        </div>
      </div>
    );
  }

  const { p10, p50, p90, unit } = estimate;
  const hasBand = p10 != null && p90 != null && p90 > p10;
  // A negative margin is a real outcome and is shown as one, never clamped.
  const negative = p50 < 0;

  return (
    <div className={className}>
      <p className="text-xs text-slate">{label}</p>
      <p
        translate="no"
        className={cn(
          "mt-0.5 font-semibold tabular-nums",
          emphasis ? "text-h3" : "text-sm",
          negative ? "text-clay" : "text-ink",
        )}
      >
        {formatEstimateValue(p50, unit)}
      </p>
      {hasBand ? (
        <p translate="no" className="text-xs tabular-nums text-slate">
          {formatEstimateValue(p10, unit)} to {formatEstimateValue(p90, unit)}
        </p>
      ) : null}
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate/80">
        {BASIS_LABEL[estimate.basis] ?? estimate.basis}
        {estimate.calibration_sample_size != null ? (
          <>
            {" · "}
            <span translate="no">n={estimate.calibration_sample_size}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
