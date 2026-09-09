"use client";

/**
 * A 0-to-1 score with its reasons.
 *
 * An unknown score is not a short bar. A bar at zero reads as "no suitability",
 * which is a claim the engine did not make, so an absent score renders as text
 * and no track at all. The number is shown alongside the bar because a bar on
 * its own cannot be read precisely.
 */
import { UnknownValue } from "@/components/ui";
import { cn } from "@/lib/utils";

export function ScoreMeter({
  score,
  label,
  missingReason,
}: {
  score: number | null | undefined;
  label: string;
  missingReason?: string | null;
}) {
  if (score == null) {
    return (
      <div>
        <p className="text-xs text-slate">{label}</p>
        <div className="mt-0.5">
          <UnknownValue label="Not known" />
        </div>
        {missingReason ? (
          <p className="mt-0.5 text-xs text-slate">{missingReason.replace(/_/g, " ")}</p>
        ) : null}
      </div>
    );
  }

  const percent = Math.round(Math.min(1, Math.max(0, score)) * 100);
  const band = percent >= 70 ? "strong" : percent >= 40 ? "fair" : "weak";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-slate">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-ink">{percent}%</p>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-mist"
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
            band === "strong" ? "bg-forest" : band === "fair" ? "bg-amber" : "bg-clay",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
