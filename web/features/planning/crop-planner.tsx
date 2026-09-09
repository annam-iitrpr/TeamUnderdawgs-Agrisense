"use client";

/**
 * P1-03 — choose a crop, or have five suggested.
 *
 * Both branches of the PRD's flow run on the same request: the engine is asked
 * to compare candidates for this field, and the difference is only how many
 * candidates and how the result is presented. That keeps one code path, so the
 * single-crop view can never disagree with the ranked list about the same crop.
 *
 * Default order is the server's own suitability ranking. The other sorts are
 * client-side reorderings of the same set, never a re-request, so a farmer
 * cannot see a different set of crops just by changing the sort.
 */
import { AppShell } from "@/components/app-shell";
import { Button, Callout, Card, ErrorState, Skeleton } from "@/components/ui";
import { useCrops } from "@/features/crops/use-crop-name";
import { newIdempotencyKey } from "@/lib/api/client";
import type { CropComparison, CropPlan, Field, Season } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { fields as fieldsApi, planning as planningApi } from "@/lib/api/routes";
import { cn } from "@/lib/utils";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CropCard } from "./crop-card";
import { CropComparisonTable } from "./crop-comparison-table";
import { relativeWaterScore } from "./water-figures";

type Sort = "suitability" | "water" | "return" | "season";

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "suitability", label: "Best suited" },
  { id: "water", label: "Least water" },
  { id: "return", label: "Highest return" },
  { id: "season", label: "Shortest season" },
];

/** Season length in days, or null when either window is unknown. */
function lengthDays(plan: CropPlan): number | null {
  if (!plan.sowing_interval || !plan.harvest_interval) return null;
  const sow = Date.parse(`${plan.sowing_interval.start_date}T00:00:00Z`);
  const cut = Date.parse(`${plan.harvest_interval.end_date}T00:00:00Z`);
  return cut > sow ? Math.round((cut - sow) / 86_400_000) : null;
}

/**
 * Order by a metric, keeping the server's ranking for anything unknown.
 *
 * A crop with no figure must not be pushed to the bottom as though it were the
 * worst: unknown is not last. Known values sort among themselves and unknowns
 * hold their original relative position at the end, flagged in the UI.
 */
function sorted(plans: CropPlan[], by: Sort): CropPlan[] {
  if (by === "suitability") return plans;
  const value = (plan: CropPlan): number | null => {
    if (by === "water") return plan.water?.seasonal?.p50 ?? null;
    if (by === "return") return plan.economics?.profit?.p50 ?? null;
    return lengthDays(plan);
  };
  const known = plans.filter((p) => value(p) != null);
  const unknown = plans.filter((p) => value(p) == null);
  known.sort((a, b) => {
    const av = value(a) as number;
    const bv = value(b) as number;
    return by === "return" ? bv - av : av - bv;
  });
  return [...known, ...unknown];
}

export function CropPlanner({ fieldId, initialCropId }: { fieldId: string; initialCropId?: string }) {
  const router = useRouter();
  const { crops, cropFor, isLoading: cropsLoading } = useCrops();

  const [comparison, setComparison] = useState<CropComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [field, setField] = useState<Field | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [sort, setSort] = useState<Sort>("suitability");
  const [compareSet, setCompareSet] = useState<ReadonlySet<string>>(new Set());
  const [choosing, setChoosing] = useState<string | null>(null);
  // Which branch of the PRD flow we are in: one named crop, or five suggestions.
  const [mode, setMode] = useState<"single" | "suggest">(initialCropId ? "single" : "suggest");
  const [focusCrop, setFocusCrop] = useState<string | undefined>(initialCropId);

  const remainingHa = useMemo(() => {
    if (!field) return 0;
    const taken = seasons
      .filter((s) => s.status !== "closed")
      .reduce((sum, s) => sum + (s.allocated_area_ha ?? 0), 0);
    return Math.max(0, Number((field.area_ha - taken).toFixed(4)));
  }, [field, seasons]);

  const run = useCallback(
    async (candidateIds: string[]) => {
      if (candidateIds.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const [{ data: fieldData }, { data: seasonPage }] = await Promise.all([
          fieldsApi.get(fieldId),
          fieldsApi.seasons(fieldId, { limit: 50 }),
        ]);
        setField(fieldData);
        setSeasons(seasonPage.items ?? []);

        const today = new Date();
        const end = new Date(today);
        end.setMonth(end.getMonth() + 6);
        const iso = (d: Date) => d.toISOString().slice(0, 10);

        const { data } = await planningApi.compare(
          {
            field_id: fieldId,
            proposed_season: { start_date: iso(today), end_date: iso(end) },
            candidate_crop_ids: candidateIds.slice(0, 5),
          },
          newIdempotencyKey(),
        );
        setComparison(data);
      } catch (cause) {
        setError(
          cause instanceof ApiError
            ? { message: cause.message, retryable: cause.retryable }
            : { message: "The comparison could not be loaded.", retryable: true },
        );
      } finally {
        setLoading(false);
      }
    },
    [fieldId],
  );

  useEffect(() => {
    if (cropsLoading || crops.length === 0) return;
    const ids = focusCrop ? [focusCrop] : crops.slice(0, 5).map((c) => c.id);
    void run(ids);
  }, [cropsLoading, crops, focusCrop, run]);

  async function choose(cropId: string) {
    if (!field) return;
    setChoosing(cropId);
    setError(null);
    try {
      await fieldsApi.createSeason(
        field.id,
        {
          crop_id: cropId,
          allocated_area_ha: remainingHa > 0 ? remainingHa : field.area_ha,
          status: "active",
        },
        newIdempotencyKey(),
      );
      router.push("/");
    } catch (cause) {
      setChoosing(null);
      setError(
        cause instanceof ApiError
          ? { message: cause.message, retryable: false }
          : { message: "That crop could not be added.", retryable: false },
      );
    }
  }

  const plans = comparison?.candidates ?? [];
  const ordered = useMemo(() => sorted(plans, sort), [plans, sort]);
  const allWater = plans.map((p) => p.water?.seasonal?.p50 ?? null);
  const comparing = ordered.filter((p) => compareSet.has(p.crop_id));

  return (
    <AppShell title={mode === "single" ? "This crop on your field" : "Crops for your field"}>
      <div className="space-y-4">
        {mode === "single" ? (
          <Button
            variant="secondary"
            onClick={() => {
              setMode("suggest");
              setFocusCrop(undefined);
            }}
          >
            <Sparkles aria-hidden className="size-4" />
            Suggest crops instead
          </Button>
        ) : focusCrop ? (
          <Button variant="secondary" onClick={() => setFocusCrop(undefined)}>
            <ArrowLeft aria-hidden className="size-4" />
            Back to all suggestions
          </Button>
        ) : null}

        {field ? (
          <Card className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate">
              {field.name}
            </p>
            <p className="mt-0.5 text-sm text-slate">
              {remainingHa > 0
                ? `${remainingHa} ha free of ${field.area_ha} ha. Figures below are for the free area.`
                : `All ${field.area_ha} ha is already assigned to a season.`}
            </p>
          </Card>
        ) : null}

        {loading || cropsLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-56 w-full rounded-card" />
            <Skeleton className="h-56 w-full rounded-card" />
          </div>
        ) : error ? (
          <ErrorState
            title="Could not compare crops"
            message={error.message}
            retryLabel="Try again"
            onRetry={
              error.retryable
                ? () => void run(focusCrop ? [focusCrop] : crops.slice(0, 5).map((c) => c.id))
                : undefined
            }
          />
        ) : (
          <>
            {mode === "suggest" && plans.length > 1 ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort suggestions">
                {SORTS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSort(option.id)}
                    aria-pressed={sort === option.id}
                    className={cn(
                      "min-h-[40px] rounded-control border px-3 text-sm font-semibold",
                      sort === option.id
                        ? "border-forest bg-forest text-white"
                        : "border-mist bg-card text-slate hover:text-ink",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}

            {plans.length === 0 ? (
              <NoCandidates comparison={comparison} fieldName={field?.name ?? "this field"} />
            ) : (
              <>
                {plans.length < 5 && mode === "suggest" ? (
                  <Callout tone="info" className="text-sm" title={`${plans.length} of five shown`}>
                    Crops are left out when they do not fit this field, this season, or the water
                    available. The reasons are listed on each card.
                  </Callout>
                ) : null}

                {comparing.length >= 2 ? (
                  <CropComparisonTable
                    plans={comparing}
                    cropFor={cropFor}
                    areaHa={remainingHa > 0 ? remainingHa : (field?.area_ha ?? 1)}
                    onClear={() => setCompareSet(new Set())}
                  />
                ) : null}

                <div className="space-y-3">
                  {ordered.map((plan, index) => (
                    <CropCard
                      key={plan.crop_id}
                      plan={plan}
                      crop={cropFor(plan.crop_id)}
                      areaHa={remainingHa > 0 ? remainingHa : (field?.area_ha ?? 1)}
                      rank={sort === "suitability" && mode === "suggest" ? index + 1 : undefined}
                      waterScore={relativeWaterScore(plan.water?.seasonal?.p50 ?? null, allWater)}
                      selected={compareSet.has(plan.crop_id)}
                      onToggleCompare={
                        mode === "suggest" && plans.length > 1
                          ? () =>
                              setCompareSet((current) => {
                                const next = new Set(current);
                                if (next.has(plan.crop_id)) next.delete(plan.crop_id);
                                else next.add(plan.crop_id);
                                return next;
                              })
                          : undefined
                      }
                      onChoose={() => void choose(plan.crop_id)}
                      choosing={choosing === plan.crop_id}
                    />
                  ))}
                </div>
              </>
            )}

            {comparison?.warnings && comparison.warnings.length > 0 ? (
              <Callout tone="info" className="text-sm" title="About these figures">
                <ul className="list-inside list-disc">
                  {comparison.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

/**
 * Why nothing came back.
 *
 * The engine's own exclusion codes are shown rather than a generic empty state,
 * because "your field is fully assigned" and "no reviewed data for your region"
 * need completely different actions from the farmer.
 */
function NoCandidates({
  comparison,
  fieldName,
}: {
  comparison: CropComparison | null;
  fieldName: string;
}) {
  const exclusions = comparison?.exclusions ?? [];
  const fullyAllocated = exclusions.some((e) => e.code === "no_unallocated_area");

  if (fullyAllocated) {
    return (
      <Callout tone="info" title="This field is fully assigned">
        <p>
          Every hectare of {fieldName} already belongs to a season, so there is no area left to
          plan for. Close a season, or reduce the area it uses, and then come back.
        </p>
      </Callout>
    );
  }

  return (
    <Callout tone="caution" title="No crop can be compared for this field yet">
      <p>
        AgriSense will not rank crops without reviewed records for your area, because a
        suitability score with nothing behind it would be a guess dressed up as advice.
      </p>
      {exclusions.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-sm">
          {exclusions.slice(0, 5).map((reason) => (
            <li key={reason.code}>{reason.code.replace(/_/g, " ")}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-sm">
        You can still add a crop directly from your field and record your season.
      </p>
    </Callout>
  );
}
