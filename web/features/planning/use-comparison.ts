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
 * The window crops are compared over: tomorrow, for the next 330 days.
 *
 * Two constraints meet here, and both were violated before.
 *
 * It starts *tomorrow*, never today: the engine refuses a window whose start
 * has already passed, and today is already partly gone wherever the farmer is
 * standing. Sending today's date produced a generic 503 that looked like an
 * outage rather than a bad request.
 *
 * It runs 330 days, not six months. Sowing windows are seasonal — paddy sows
 * in June, sugarcane in February, wheat in November — so a six-month window
 * silently excluded every crop whose season fell outside it, reporting
 * `outside_local_sowing_calendar` as though the crop were unsuitable rather
 * than merely out of view. It stops short of a full year because the planner
 * compares against reanalysis from the same window one year back, and that has
 * to be settled: a 365-day window puts the reanalysis end date in the future
 * and the whole comparison is refused with `historical_climate_required`.
 */
const COMPARISON_DAYS = 330;

export function defaultSowingWindow(): { start_date: string; end_date: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + COMPARISON_DAYS);
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

/**
 * What the farmer has to spend on the season, in water and in cash.
 *
 * The engine requires both to be *stated*, not merely plausible: it excludes a
 * crop for `irrigation_budget_missing_or_insufficient` or
 * `cash_budget_missing_or_insufficient` when either is absent, because
 * recommending a crop that needs more water than the farmer can lift is worse
 * than recommending nothing. `null` is therefore a real answer that will be
 * refused, not a value to be quietly defaulted to zero or to infinity.
 */
export type SeasonBudget = {
  availableWaterM3: number | null;
  budgetInr: number | null;
};

export function useComparison(fieldId: string | null) {
  const [comparison, setComparison] = useState<CropComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);

  // Guards against a slow first response overwriting a newer one when the
  // farmer switches between "suggest" and a single named crop quickly.
  const latest = useRef(0);

  const run = useCallback(
    async (candidateIds: readonly string[], budget?: SeasonBudget) => {
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
            // Sent only when known. An omitted budget is refused by the engine
            // with a stated reason, which is the correct outcome; inventing one
            // would make the refusal disappear and the advice unsafe.
            ...(budget?.availableWaterM3 == null
              ? {}
              : { available_water_m3: budget.availableWaterM3 }),
            ...(budget?.budgetInr == null ? {} : { budget_inr: budget.budgetInr }),
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

/** Re-runs the comparison whenever the candidate set or the budget changes. */
export function useAutoComparison(
  fieldId: string | null,
  candidateIds: readonly string[],
  budget?: SeasonBudget,
) {
  const state = useComparison(fieldId);
  const { run } = state;
  const key = candidateIds.join(",");
  // Primitives, so the effect does not re-fire on a fresh object each render.
  const water = budget?.availableWaterM3 ?? null;
  const cash = budget?.budgetInr ?? null;
  useEffect(() => {
    if (!fieldId || key === "") return;
    void run(key.split(","), { availableWaterM3: water, budgetInr: cash });
  }, [fieldId, key, run, water, cash]);
  return state;
}
