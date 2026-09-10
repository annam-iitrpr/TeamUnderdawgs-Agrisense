"use client";

/**
 * Running a crop comparison against a saved field.
 *
 * Both the planner screen and the onboarding crop step ask the same question —
 * "what would these crops do on this field" — so the request shape, the sowing
 * window and the ranking live here rather than being written twice. They had
 * started to diverge once already: onboarding needs the answer before the
 * farmer has ever seen the dashboard, and a second copy of this would drift.
 */
import { newIdempotencyKey } from "@/lib/api/client";
import type { CropComparison, CropPlan } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { planning as planningApi } from "@/lib/api/routes";
import { useCallback, useEffect, useRef, useState } from "react";
import { relativeWaterScore } from "./water-figures";

/** The engine takes at most five candidates in one request. */
export const MAX_CANDIDATES = 5;

/**
 * Sowing starts tomorrow, never today.
 *
 * The engine refuses a window whose start has already passed, and "today" is
 * already partly gone wherever the farmer is standing. Sending today's date
 * produced a generic 503 that looked like an outage rather than a bad request.
 */
export function defaultSowingWindow(): { start_date: string; end_date: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start_date: iso(start), end_date: iso(end) };
}

/**
 * The server's ranking is authoritative and is never re-derived here.
 *
 * `candidates` arrives already ordered by the engine's own suitability
 * judgement, which weighs more than the compatibility map exposes. Re-sorting
 * by the mean of that map would quietly disagree with the engine about which
 * crop is best, so callers that want suitability order use the array as given.
 */

export function useComparison(fieldId: string | null) {
  const [comparison, setComparison] = useState<CropComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);

  // Guards against a slow first response overwriting a newer one when the
  // farmer switches between "suggest" and a single named crop quickly.
  const latest = useRef(0);

  const run = useCallback(
    async (candidateIds: readonly string[]) => {
      if (!fieldId || candidateIds.length === 0) return;
      const ticket = ++latest.current;
      setLoading(true);
      setError(null);
      try {
        const { data } = await planningApi.compare(
          {
            field_id: fieldId,
            proposed_season: defaultSowingWindow(),
            candidate_crop_ids: [...candidateIds].slice(0, MAX_CANDIDATES),
          },
          newIdempotencyKey(),
        );
        if (ticket === latest.current) setComparison(data);
      } catch (cause) {
        if (ticket !== latest.current) return;
        setError(
          cause instanceof ApiError
            ? { message: cause.message, retryable: cause.retryable }
            : { message: "The comparison could not be loaded.", retryable: true },
        );
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    },
    [fieldId],
  );

  return { comparison, loading, error, run, setError };
}

/**
 * Water scores for a whole set at once.
 *
 * The score is relative to the candidates on screen, so it can only be worked
 * out for the set as a whole — computing it per card would give each card a
 * different baseline.
 */
export function waterScores(plans: readonly CropPlan[]): Map<string, number | null> {
  const all = plans.map((p) => p.water?.seasonal?.p50 ?? null);
  return new Map(
    plans.map((p) => [p.crop_id, relativeWaterScore(p.water?.seasonal?.p50 ?? null, all)]),
  );
}

/** Re-runs the comparison whenever the candidate set changes. */
export function useAutoComparison(fieldId: string | null, candidateIds: readonly string[]) {
  const state = useComparison(fieldId);
  const { run } = state;
  const key = candidateIds.join(",");
  useEffect(() => {
    if (!fieldId || key === "") return;
    void run(key.split(","));
  }, [fieldId, key, run]);
  return state;
}
