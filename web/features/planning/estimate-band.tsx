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
import { cn } from "@/lib/utils";
import { explainCode } from "@/lib/missing-reasons";

const BASIS_LABEL: Record<string, string> = {
  scenario: "Scenario",
  empirically_calibrated: "Calibrated",
  observed: "Observed",
};

/** Rupees read better whole; a rate like ROI keeps one decimal. */
function formatValue(value: number, unit: string): string {
  if (unit === "INR") return `₹${Math.round(value).toLocaleString("en-IN")}`;
  if (unit === "%" || unit === "ratio") return `${value.toFixed(1)}${unit === "%" ? "%" : ""}`;
  if (unit === "mm") return `${Math.round(value)} mm`;
  if (unit === "kg" || unit === "kg/ha") return `${Math.round(value).toLocaleString("en-IN")} ${unit}`;
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${unit}`;
}

export function EstimateBand({
  estimate,
  label,
  emphasis,
  className,
}: {
  estimate: Estimate | null | undefined;
  label: string;
  emphasis?: boolean;
  className?: string;
}) {
  if (!estimate || estimate.p50 == null) {
    return (
      <div className={className}>
        <p className="text-xs text-slate">{label}</p>
        <div className="mt-0.5">
          <UnknownValue label="Not known" />
        </div>
        {estimate?.missing_reason ? (
          <p className="mt-0.5 text-xs text-slate">{explainCode(estimate.missing_reason)}</p>
        ) : null}
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
        className={cn(
          "mt-0.5 font-semibold tabular-nums",
          emphasis ? "text-h3" : "text-sm",
          negative ? "text-clay" : "text-ink",
        )}
      >
        {formatValue(p50, unit)}
      </p>
      {hasBand ? (
        <p className="text-xs tabular-nums text-slate">
          {formatValue(p10, unit)} to {formatValue(p90, unit)}
        </p>
      ) : null}
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate/80">
        {BASIS_LABEL[estimate.basis] ?? estimate.basis}
        {estimate.calibration_sample_size != null
          ? ` · n=${estimate.calibration_sample_size}`
          : ""}
      </p>
    </div>
  );
}
