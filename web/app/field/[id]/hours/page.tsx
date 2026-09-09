"use client";

import { PhoneFrame } from "@/components/phone-frame";
import { useApp } from "@/components/providers";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError, type HourScore, type HoursResponse } from "@/lib/api";
import { cn, formatShortDay } from "@/lib/utils";
import { Check, Droplets, Wind, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** The grid shows the working part of the day. Nobody sprays at 2am. */
const HOURS = Array.from({ length: 16 }, (_, i) => i + 4); // 04:00 to 19:00

export default function HoursPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { t, language } = useApp();

  const [data, setData] = useState<HoursResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HourScore | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .hours(id)
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "We could not load the hours."),
      );
  }, [id]);

  useEffect(load, [load]);

  if (error) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("hoursTitle")}>
        <div className="p-4">
          <ErrorState
            title={t("errorTitle")}
            message={error}
            retryLabel={t("retry")}
            onRetry={load}
          />
        </div>
      </PhoneFrame>
    );
  }

  if (!data) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("hoursTitle")}>
        <div className="space-y-3 p-4" aria-busy="true">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-[17rem] w-full rounded-card" />
        </div>
      </PhoneFrame>
    );
  }

  // Group into days, keeping only the working hours.
  const byDay = new Map<string, Map<number, HourScore>>();
  for (const h of data.hours) {
    const day = h.timestamp.slice(0, 10);
    const hour = new Date(h.timestamp).getHours();
    if (!HOURS.includes(hour)) continue;
    if (!byDay.has(day)) byDay.set(day, new Map());
    byDay.get(day)!.set(hour, h);
  }
  const days = [...byDay.keys()].sort().slice(0, 7);

  if (days.length === 0) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("hoursTitle")}>
        <div className="p-4">
          <EmptyState
            title={t("noHoursTitle")}
            message="No hourly forecast is available for this field right now."
          />
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame backHref={`/field/${id}`} title={t("hoursTitle")}>
      <div className="animate-rise space-y-4 p-4">
        <p className="text-sm text-slate">{t("hoursSubtitle")}</p>

        <Card className="overflow-hidden p-3">
          <p className="mb-2 text-xs text-slate sm:hidden">
            Scroll the grid sideways to see the whole day.
          </p>
          {/* The grid scrolls inside its own container so the page never does. */}
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0.5">
              <caption className="sr-only">
                Spray viability by day and hour. Each cell is either suitable or
                gives a reason it was ruled out.
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 w-12 bg-card"
                  />
                  {HOURS.filter((h) => h % 2 === 0).map((h) => (
                    <th
                      key={h}
                      scope="col"
                      colSpan={2}
                      className="pb-1 text-xs font-medium text-slate"
                    >
                      {String(h).padStart(2, "0")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day}>
                    <th
                      scope="row"
                      // Stays put while the hours scroll, so a cell is never
                      // orphaned from the day it belongs to.
                      className="sticky left-0 z-10 bg-card pr-1.5 text-right text-xs font-medium text-slate"
                    >
                      {formatShortDay(day, language)}
                    </th>
                    {HOURS.map((hour) => {
                      const cell = byDay.get(day)?.get(hour);
                      const isSelected =
                        selected?.timestamp === cell?.timestamp && !!cell;
                      return (
                        <td key={hour} className="p-0">
                          <button
                            disabled={!cell}
                            onClick={() => cell && setSelected(cell)}
                            aria-label={
                              cell
                                ? `${formatShortDay(day, language)} ${String(hour).padStart(2, "0")}:00, ${
                                    cell.viable
                                      ? "suitable for spraying"
                                      : cell.rejection_reason ?? "not suitable"
                                  }`
                                : "no data"
                            }
                            className={cn(
                              // Sized to be tappable. The grid scrolls inside its
                              // own container rather than shrinking below a usable
                              // target size.
                              "h-10 w-full min-w-[2.2rem] rounded-[4px] transition-transform duration-[120ms]",
                              cell ? "cursor-pointer" : "cursor-default",
                              isSelected &&
                                "outline outline-2 outline-offset-1 outline-ink",
                            )}
                            style={{
                              backgroundColor: !cell
                                ? "var(--mist)"
                                : cell.viable
                                  ? `color-mix(in srgb, var(--sprout) ${28 + cell.score * 62}%, white)`
                                  : "color-mix(in srgb, var(--clay) 16%, white)",
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-mist pt-2.5 text-xs">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-3 rounded-[3px]"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--sprout) 78%, white)",
                }}
              />
              {t("viable")}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-3 rounded-[3px]"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--clay) 16%, white)",
                }}
              />
              {t("rejected")}
            </span>
          </div>
        </Card>

        {/* The rejection reason is a first class output, so it gets real space. */}
        <div aria-live="polite">
          {selected ? (
            <HourDetail hour={selected} />
          ) : (
            <Card className="p-4">
              <p className="text-sm text-slate">{t("hoursSubtitle")}</p>
            </Card>
          )}
        </div>
      </div>
    </PhoneFrame>
  );
}

function HourDetail({ hour }: { hour: HourScore }) {
  const { t, language } = useApp();
  const time = new Date(hour.timestamp);

  return (
    <Card
      className={cn(
        "animate-rise p-4",
        hour.viable
          ? "border-sprout bg-[color-mix(in_srgb,var(--sprout)_7%,var(--card))]"
          : "border-clay bg-[color-mix(in_srgb,var(--clay)_6%,var(--card))]",
      )}
    >
      <div className="flex items-center gap-2">
        {hour.viable ? (
          <Check aria-hidden className="size-5 shrink-0 text-forest" />
        ) : (
          <X aria-hidden className="size-5 shrink-0 text-clay" />
        )}
        <p className="text-h3 font-semibold tracking-tight">
          {formatShortDay(hour.timestamp, language)}
          {", "}
          {String(time.getHours()).padStart(2, "0")}:00
        </p>
      </div>

      <p className="mt-1.5 text-body">
        {hour.viable
          ? "Conditions in this hour let the droplet reach the leaf and stay there long enough to be absorbed."
          : hour.rejection_reason}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-mist pt-3 text-sm">
        <div className="flex items-center gap-1.5">
          <Droplets aria-hidden className="size-4 shrink-0 text-slate" />
          <dt className="text-slate">{t("deltaT")}</dt>
          <dd className="score-value ml-auto font-semibold">{hour.delta_t}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <Wind aria-hidden className="size-4 shrink-0 text-slate" />
          <dt className="text-slate">{t("wind")}</dt>
          <dd className="score-value ml-auto font-semibold">
            {hour.wind_kmh.toFixed(0)} km/h
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-slate">{t("temperature")}</dt>
          <dd className="score-value ml-auto font-semibold">
            {hour.temperature_c.toFixed(0)}
            {"°C"}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-slate">{t("humidity")}</dt>
          <dd className="score-value ml-auto font-semibold">
            {hour.humidity_pct.toFixed(0)}%
          </dd>
        </div>
      </dl>
    </Card>
  );
}
