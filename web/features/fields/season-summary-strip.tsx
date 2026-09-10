"use client";

/**
 * P1-04 — the season's three headline numbers, on the card itself.
 *
 * These each have a screen of their own. What was missing was the glance: a
 * farmer opening the app should see where the season stands on water, money and
 * risk without navigating three times.
 *
 * Each figure is fetched separately and fails separately. Water being
 * unavailable must not blank the profit, and neither must blank the weather —
 * they come from different dependencies and one being missing says nothing
 * about the others. Nothing here falls back to zero: a zero water requirement
 * and a zero profit are both claims, and an empty risk strip reads as "calm".
 */
import { UnknownValue } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { litresFromMeasurement, formatLitres } from "@/features/planning/water-figures";
import type { Recommendation, StressPoint } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/query";
import { seasons as seasonsApi } from "@/lib/api/routes";
import { cn } from "@/lib/utils";
import { CloudRain, Droplets, IndianRupee, Wind } from "lucide-react";
import Link from "next/link";

const IST = "Asia/Kolkata";

function rupees(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 100_000) return `₹${(rounded / 100_000).toFixed(1)}L`;
  return `₹${rounded.toLocaleString("en-IN")}`;
}

/** The worst projected stress in the days ahead, and when it lands. */
function peakStress(points: readonly StressPoint[]): { value: number; date: string } | null {
  let worst: { value: number; date: string } | null = null;
  for (const point of points) {
    if (point.value == null) continue;
    if (worst == null || point.value > worst.value) {
      worst = { value: point.value, date: point.local_date };
    }
  }
  return worst;
}

export function SeasonSummaryStrip({
  seasonId,
  areaHa,
  recommendation,
  adviceExpired,
}: {
  seasonId: string;
  areaHa: number;
  recommendation: Recommendation | null;
  /** Advice existed and aged out, which is not the same as never having any. */
  adviceExpired?: boolean;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const enabled = Boolean(uid);

  const waterQuery = useApiQuery(
    [uid, "season", seasonId, "water"],
    (signal) => seasonsApi.water(seasonId, { signal }),
    { enabled },
  );
  const economicsQuery = useApiQuery(
    [uid, "season", seasonId, "economics"],
    (signal) => seasonsApi.economics(seasonId, { signal }),
    { enabled },
  );
  const forecastQuery = useApiQuery(
    [uid, "season", seasonId, "forecast"],
    (signal) => seasonsApi.forecast(seasonId, { signal }),
    { enabled },
  );

  const water = waterQuery.data ?? null;
  const economics = economicsQuery.data ?? null;
  const forecast = forecastQuery.data ?? null;

  const seasonLitres = litresFromMeasurement(
    water?.seasonal?.p50,
    water?.seasonal?.unit,
    areaHa,
  );
  // The nearest day-by-day figure that is actually known. The list holds
  // replenishment alternatives, so one of them is a real answer while their sum
  // is not — hence "next", never a total.
  const nextDay = (water?.daily ?? []).find((row) => row.value != null) ?? null;
  const nextDayLitres = litresFromMeasurement(nextDay?.value, nextDay?.unit, areaHa);

  const profit = economics?.profit?.p50 ?? null;
  const peak = peakStress(recommendation?.stress_curve ?? []);

  return (
    <div className="mt-4 grid gap-2 border-t border-mist pt-4 sm:grid-cols-3">
      <Tile
        href={`/water?season=${encodeURIComponent(seasonId)}`}
        icon={<Droplets aria-hidden className="size-4 text-forest" />}
        label="Water"
        loading={waterQuery.isLoading}
      >
        {nextDayLitres != null ? (
          <>
            <span className="font-semibold text-ink">{formatLitres(nextDayLitres)}</span>
            <span className="block text-xs text-slate">if you irrigate next</span>
          </>
        ) : seasonLitres != null ? (
          <>
            <span className="font-semibold text-ink">{formatLitres(seasonLitres)}</span>
            <span className="block text-xs text-slate">whole season</span>
          </>
        ) : (
          <UnknownValue
            label="Not known"
            reason={
              waterQuery.error?.isDependencyUnavailable
                ? "service unavailable"
                : water?.missing_reason
                  ? water.missing_reason.replace(/_/g, " ")
                  : undefined
            }
          />
        )}
      </Tile>

      <Tile
        href={`/money?season=${encodeURIComponent(seasonId)}`}
        icon={<IndianRupee aria-hidden className="size-4 text-forest" />}
        label="Profit"
        loading={economicsQuery.isLoading}
      >
        {profit != null ? (
          <>
            <span className={cn("font-semibold", profit < 0 ? "text-clay" : "text-ink")}>
              {rupees(profit)}
            </span>
            <span className="block text-xs text-slate">
              {profit < 0 ? "projected loss" : "projected"}
            </span>
          </>
        ) : (
          <UnknownValue
            label="Not known"
            reason={
              economicsQuery.error?.isDependencyUnavailable
                ? "service unavailable"
                : economics?.profit?.missing_reason
                  ? economics.profit.missing_reason.replace(/_/g, " ")
                  : undefined
            }
          />
        )}
      </Tile>

      <Tile
        href={`/readiness?season=${encodeURIComponent(seasonId)}`}
        icon={<Wind aria-hidden className="size-4 text-forest" />}
        label="Risk ahead"
        loading={forecastQuery.isLoading}
      >
        {peak != null ? (
          <>
            <span
              className={cn(
                "font-semibold",
                peak.value >= 0.66 ? "text-clay" : peak.value >= 0.33 ? "text-amber-ink" : "text-ink",
              )}
            >
              {peak.value >= 0.66 ? "High" : peak.value >= 0.33 ? "Some" : "Low"}
            </span>
            <span className="block text-xs text-slate">
              worst{" "}
              {new Date(`${peak.date}T00:00:00Z`).toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
                timeZone: "UTC",
              })}
            </span>
          </>
        ) : (
          <UnknownValue
            label="Not known"
            reason={
              recommendation
                ? "no stress projection"
                : adviceExpired
                  ? "advice expired"
                  : "not worked out yet"
            }
          />
        )}
      </Tile>

      {/* Where the weather came from and when, on the card rather than buried.
          A figure from a forecast read three days ago is a different thing from
          one read this morning, and only the timestamp says which. */}
      {forecast ? (
        <p className="text-xs text-slate sm:col-span-3">
          <CloudRain aria-hidden className="mr-1 inline size-3" />
          Weather from {forecast.provider}, read{" "}
          {new Date(forecast.retrieved_at).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
            timeZone: IST,
          })}
          {forecast.grid_resolution_km
            ? `, on a ${forecast.grid_resolution_km} km grid rather than your exact field`
            : ""}
          .
        </p>
      ) : forecastQuery.error ? (
        <p className="text-xs text-slate sm:col-span-3">
          The weather for this field could not be read just now, so the risk above may be stale.
        </p>
      ) : null}
    </div>
  );
}

function Tile({
  href,
  icon,
  label,
  loading,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-control border border-mist bg-card p-3 transition-colors hover:border-forest/40"
    >
      <span className="flex items-center gap-1.5 text-xs text-slate">
        {icon}
        {label}
      </span>
      <span className="mt-1 block text-sm">
        {loading ? <span className="text-slate">Loading…</span> : children}
      </span>
    </Link>
  );
}
