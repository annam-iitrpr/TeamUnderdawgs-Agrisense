"use client";

/**
 * The projected daily stress, drawn only as far as the projection actually reaches.
 *
 * Two things this deliberately does not do:
 *
 * 1. It does not blend stress types. The contract carries one point per
 *    (date, stress_type), so heat stress and moisture stress arrive as separate
 *    points on the same day. Averaging them would produce a middling bar that
 *    describes neither, so each type gets its own row.
 * 2. It does not draw a missing day as zero. A column at the bottom of the axis
 *    reads as "calm", which is the opposite of "we could not work it out". Those
 *    days are drawn as an empty dashed slot and counted in the caption.
 */
import type { StressPoint } from "@/lib/api/contract";
import { cn } from "@/lib/utils";

function toneFor(value: number): string {
  if (value >= 0.66) return "bg-clay";
  if (value >= 0.33) return "bg-amber";
  return "bg-forest";
}

function readableType(stressType: string): string {
  return stressType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * A bare day number, except where the month changes — "31, 1, 2" is ambiguous,
 * so the first column and every first-of-month carry the month with them.
 */
function dayLabel(iso: string, previous: string | undefined): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const sameMonth = previous != null && previous.slice(0, 7) === iso.slice(0, 7);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    ...(sameMonth ? {} : { month: "short" }),
    timeZone: "UTC",
  });
}

/** Groups points by stress type, keeping every series on the same date axis. */
function series(points: StressPoint[]): { type: string; byDate: Map<string, StressPoint> }[] {
  const grouped = new Map<string, Map<string, StressPoint>>();
  for (const point of points) {
    let byDate = grouped.get(point.stress_type);
    if (!byDate) {
      byDate = new Map();
      grouped.set(point.stress_type, byDate);
    }
    // Later points win, matching the engine's own ordering.
    byDate.set(point.local_date, point);
  }
  return [...grouped.entries()].map(([type, byDate]) => ({ type, byDate }));
}

export function StressCurve({ points }: { points: StressPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-slate">No daily projection is available for this season yet.</p>
    );
  }

  const dates = [...new Set(points.map((p) => p.local_date))].sort();
  const rows = series(points);
  const known = points.filter((p) => p.value != null).length;

  return (
    <div className="space-y-3">
      {/*
        Only the chart scrolls. The caption used to sit inside this container
        and inherited its minimum width, so on a narrow phone the sentence
        explaining what a dashed column means was itself clipped off-screen.
      */}
      <div className="overflow-x-auto">
        <div className="min-w-[20rem] space-y-3">
          {rows.map((row) => (
            <div key={row.type}>
              <p className="text-xs font-semibold text-ink">{readableType(row.type)}</p>
              <div
                className="mt-1 flex items-end gap-0.5"
                role="img"
                aria-label={`${readableType(row.type)} projected over ${dates.length} days`}
              >
                {dates.map((date) => {
                  const point = row.byDate.get(date);
                  const value = point?.value ?? null;
                  return (
                    <div key={date} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex h-12 w-full items-end justify-center">
                        {value == null ? (
                          <span
                            className="h-full w-full rounded-sm border border-dashed border-mist"
                            title={point?.missing_reason ?? "Not known"}
                          />
                        ) : (
                          <span
                            className={cn("w-full rounded-sm", toneFor(value))}
                            style={{
                              height: `${Math.max(4, Math.round(value * 48))}px`,
                            }}
                            title={`${date}: ${Math.round(value * 100)}%`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex gap-0.5" aria-hidden>
            {dates.map((date, index) => (
              <span
                key={date}
                className="flex-1 whitespace-nowrap text-center text-[10px] text-slate"
              >
                {dayLabel(date, dates[index - 1])}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate">
        {known} of {points.length} projected points are known. A dashed column is a day the engine
        could not work out, which is not the same as a calm day.
      </p>
    </div>
  );
}
