"use client";

/**
 * P1-06 — the water side of the same season.
 *
 * Three quantities are kept apart because they are not the same thing: what the
 * crop loses to evaporation and transpiration, how much of that has to be
 * supplied by irrigation once rain is counted, and the volume that actually has
 * to leave a pump once the system's losses are allowed for. Collapsing them into
 * one "water needed" figure is how a farmer ends up under-irrigating.
 *
 * Millimetres are a depth and are independent of area; litres are not. Both are
 * shown because a farmer fills a channel in litres and reads advice in mm.
 *
 * Any modelled soil moisture is labelled as modelled. Presenting a calculated
 * root-zone figure as though a sensor measured it would be a lie about where
 * the number came from.
 */
import { AppShell } from "@/components/app-shell";
import { Callout, Card, ErrorState, Skeleton, UnknownValue } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { EstimateBand } from "@/features/planning/estimate-band";
import {
  formatLitres,
  litresFromMeasurement,
  splitDayReason,
} from "@/features/planning/water-figures";
import type { Measurement, Season, WaterEstimate } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/query";
import { seasons as seasonsApi } from "@/lib/api/routes";
import { CloudRain, Droplets, Info } from "lucide-react";
import Link from "next/link";
import { explainCode, explainMissing } from "@/lib/missing-reasons";

export function WaterScreen({ seasonId }: { seasonId: string }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const seasonQuery = useApiQuery(
    [uid, "season", seasonId],
    (signal) => seasonsApi.get(seasonId, { signal }),
    { enabled: Boolean(uid) },
  );
  const waterQuery = useApiQuery(
    [uid, "season", seasonId, "water"],
    (signal) => seasonsApi.water(seasonId, { signal }),
    { enabled: Boolean(uid) },
  );

  const season: Season | null = seasonQuery.data ?? null;
  const water: WaterEstimate | null = waterQuery.data ?? null;
  const areaHa = season?.allocated_area_ha ?? 1;

  return (
    <AppShell title="Water">
      <div className="space-y-4">
        {season ? (
          <Card className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate">
              {season.status} season
            </p>
            <p className="mt-0.5 text-h3 font-semibold capitalize text-ink">{season.crop_id}</p>
            <p className="mt-0.5 text-sm text-slate">{areaHa} ha</p>
          </Card>
        ) : (
          <Skeleton className="h-24 w-full rounded-card" />
        )}

        {waterQuery.isLoading ? (
          <Skeleton className="h-56 w-full rounded-card" />
        ) : waterQuery.error ? (
          waterQuery.error.isDependencyUnavailable ? (
            <Callout tone="caution" title="No water plan for this season yet">
              <p>
                A water plan needs this season evaluated against a forecast and reviewed crop
                water records for your area. AgriSense will not put a figure on how much to
                irrigate without them, because under-watering on a wrong number costs a season.
              </p>
              <Link href="/journal" className="mt-2 inline-block text-sm font-semibold text-forest underline">
                Record when you last watered
              </Link>
            </Callout>
          ) : (
            <ErrorState title="Could not load the water view" message={waterQuery.error.message} />
          )
        ) : water ? (
          <>
            <SeasonalNeed water={water} areaHa={areaHa} />
            <DailyPlan daily={water.daily ?? []} areaHa={areaHa} />
            {water.assumptions && water.assumptions.length > 0 ? (
              <Card className="p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Info aria-hidden className="size-4 text-forest" />
                  What this assumes
                </p>
                <ul className="mt-2 list-inside list-disc text-sm text-slate">
                  {water.assumptions.map((item) => (
                    <li key={item}>{explainCode(item)}</li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function SeasonalNeed({ water, areaHa }: { water: WaterEstimate; areaHa: number }) {
  // Unit-aware: the seasonal estimate arrives in cubic metres, not millimetres.
  // Treating it as a depth multiplied it by ten thousand.
  const litres = litresFromMeasurement(
    water.seasonal?.p50,
    water.seasonal?.unit,
    areaHa,
  );

  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate">
        <Droplets aria-hidden className="size-3.5" />
        Water for the whole season
      </p>

      <div className="mt-2">
        <EstimateBand estimate={water.seasonal} label="" emphasis />
      </div>

      {litres != null ? (
        <p className="mt-1 text-sm text-slate">
          About {formatLitres(litres)} across your {areaHa} ha for the whole season.
        </p>
      ) : null}

      {water.irrigation_needed === false ? (
        <Callout tone="success" className="mt-3 text-sm" title="Rain is expected to cover this">
          On the current forecast this season does not need irrigation. Check again if the rain
          does not arrive.
        </Callout>
      ) : water.irrigation_needed === true ? (
        <Callout tone="info" className="mt-3 text-sm" title="Irrigation will be needed">
          Rain alone is not expected to meet this crop&rsquo;s need over the season.
        </Callout>
      ) : (
        <p className="mt-3 text-sm text-slate">
          Whether irrigation is needed over the whole season is not known yet.
          {water.missing_reason ? ` It ${explainMissing(water.missing_reason)}.` : ""}
        </p>
      )}
    </Card>
  );
}

/**
 * The day-by-day figures, which are a forecast and are labelled as one.
 *
 * This is deliberately separate from the seasonal total: a seasonal requirement
 * is a climatological expectation for the crop, while these come from a
 * forecast that only reaches a few days out.
 */
function DailyPlan({ daily, areaHa }: { daily: Measurement[]; areaHa: number }) {
  if (daily.length === 0) {
    return (
      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CloudRain aria-hidden className="size-4 text-forest" />
          Day by day
        </p>
        <p className="mt-1 text-sm text-slate">
          No daily figures are available for this season yet. The seasonal total above is a
          different thing: it is what the crop needs overall, not what to apply this week.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <CloudRain aria-hidden className="size-4 text-forest" />
        Day by day, from the forecast
      </p>
      <p className="mt-1 text-xs text-slate">
        These come from a weather forecast and get less certain further out.
      </p>
      {/*
        The engine's own assumption for these is
        `daily_values_are_replenishment_alternatives_do_not_sum`. A plain list of
        numbers invites exactly that addition, so it is ruled out in words.
      */}
      <Callout tone="caution" className="mt-2 text-xs">
        Each row is an alternative, not an instalment. It is how much to put on
        <em> if you irrigate that day</em>. Do not add them up.
      </Callout>
      <ul className="mt-3 divide-y divide-mist">
        {daily.slice(0, 14).map((measurement, index) => {
          const { date, reason } = splitDayReason(measurement.missing_reason);
          // Already litres for the allocated area. The previous version labelled
          // it "L" and then also converted it as though it were millimetres,
          // printing two different numbers for the same figure.
          const litres = litresFromMeasurement(measurement.value, measurement.unit, areaHa);
          return (
            <li
              key={measurement.missing_reason ?? index}
              className="flex items-baseline justify-between gap-3 py-2"
            >
              <span className="text-sm text-slate">
                {date
                  ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      timeZone: "UTC",
                    })
                  : `Day ${index + 1}`}
              </span>
              <span className="text-right">
                {litres != null ? (
                  <span className="font-semibold tabular-nums text-ink">
                    {formatLitres(litres)}
                  </span>
                ) : (
                  <UnknownValue
                    label="Not known"
                    reason={explainMissing(reason) ?? undefined}
                  />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
