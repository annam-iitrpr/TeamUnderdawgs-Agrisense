"use client";

import { PhoneFrame } from "@/components/phone-frame";
import { ReminderToggle, useApp } from "@/components/providers";
import { Button, Card, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError, type ScoreResponse } from "@/lib/api";
import { cn, formatDay, formatHour, formatRupees } from "@/lib/utils";
import { BookOpen, CalendarClock, CloudRain, HelpCircle, History } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { t, language } = useApp();

  const [data, setData] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    api
      .score(id, language)
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "We could not score this field."),
      );
  }, [id, language]);

  useEffect(load, [load]);

  if (error) {
    return (
      <PhoneFrame backHref="/">
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

  if (!data) return <ResultSkeleton />;

  return (
    <PhoneFrame backHref="/" title={data.field?.name ?? t("appName")}>
      {data.actionable && data.window ? (
        <Recommendation data={data} />
      ) : (
        <NoWindow data={data} />
      )}
    </PhoneFrame>
  );
}

/* ------------------------------------------------- S2, the recommendation */

function Recommendation({ data }: { data: ScoreResponse }) {
  const { t, language } = useApp();
  const w = data.window!;

  return (
    <div className="animate-rise space-y-5 p-4">
      {/* The window, as large as it can honestly be. This is the answer. */}
      <section className="rounded-card bg-forest px-5 py-6 text-white">
        <p className="text-sm font-semibold uppercase tracking-wide text-white/75">
          {t("sprayOn")}
        </p>
        <p className="score-value mt-1 text-display font-semibold leading-none">
          {formatDay(w.start, language)}
        </p>
        <p className="score-value mt-2 text-h1 font-semibold text-white/95">
          {formatHour(w.start)} {t("timeTo")} {formatHour(w.end)}
        </p>
        <p className="mt-3 border-t border-white/20 pt-3 text-body text-white/95">
          {data.reason_text}
        </p>
      </section>

      <ScoreBars data={data} />

      {data.value_estimate ? (
        <Card className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate">{t("valueEstimate")}</h2>
            {/* Never hidden in a tooltip. It sits next to the number. */}
            <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] px-2 py-0.5 text-xs font-semibold text-amber-ink">
              {t("modelEstimate")}
            </span>
          </div>
          <p className="score-value mt-1 text-h1 font-semibold tracking-tight">
            {formatRupees(data.value_estimate.low_inr)} to{" "}
            {formatRupees(data.value_estimate.high_inr)}
          </p>
          <p className="mt-1.5 text-xs text-slate">
            {t("valueBasis")
              .replace("{days}", String(data.value_estimate.delay_days))
              .replace("{stress}", String(data.value_estimate.stress_days))
              .replace("{area}", String(data.value_estimate.area_ha))}
          </p>
        </Card>
      ) : null}

      <div className="flex gap-2">
        <ReminderToggle label={t("setReminder")} doneLabel={t("reminderSet")} />
      </div>

      <NavLinks id={data.field.id} whyLabel={t("whyThisWindow")} />
    </div>
  );
}

/* ------------------------------------------- S5, the designed wait state */

function NoWindow({ data }: { data: ScoreResponse }) {
  const { t, language } = useApp();

  return (
    <div className="animate-rise space-y-5 p-4">
      <section className="rounded-card border border-mist bg-[color-mix(in_srgb,var(--clay)_7%,var(--card))] px-5 py-7 text-center">
        <CloudRain aria-hidden className="mx-auto size-9 text-clay" />
        <p className="mt-3 text-h1 font-semibold tracking-tight text-clay">
          {t("doNotSpray")}
        </p>
        <p className="mx-auto mt-2 max-w-[30ch] text-body text-ink">
          {data.reason_text}
        </p>
      </section>

      {data.check_again_on ? (
        <Card className="flex items-center gap-3 p-4">
          <CalendarClock aria-hidden className="size-5 shrink-0 text-navy" />
          <div>
            <p className="text-sm font-semibold">{t("checkAgain")}</p>
            <p className="score-value text-h3 font-semibold">
              {formatDay(data.check_again_on, language)}
            </p>
          </div>
        </Card>
      ) : null}

      <ScoreBars data={data} />

      <ReminderToggle label={t("remindMe")} doneLabel={t("reminderSet")} />

      <NavLinks id={data.field.id} whyLabel={t("whyThisWindow")} />
    </div>
  );
}

/* ------------------------------------------------------------ score bars */

/** The decomposition made visible. Three bars, no jargon, always all three. */
function ScoreBars({ data }: { data: ScoreResponse }) {
  const { t } = useApp();
  const parts = [
    { label: t("need"), value: data.need },
    { label: t("timing"), value: data.timing_fit },
    { label: t("conditions"), value: data.viability },
  ];

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate">{t("readiness")}</h2>
        <p className="score-value text-h1 font-semibold leading-none tracking-tight">
          {data.readiness_score}
          <span className="text-h3 font-medium text-slate">/100</span>
        </p>
      </div>
      <ul className="space-y-2.5">
        {parts.map((p) => (
          <li key={p.label} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2">
            <span className="text-sm text-slate">{p.label}</span>
            <span
              className="h-2 overflow-hidden rounded-full bg-mist"
              role="img"
              aria-label={`${p.label} ${Math.round(p.value * 100)} out of 100`}
            >
              <span
                className="block h-full rounded-full bg-sprout transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(p.value * 100, 1.5)}%` }}
              />
            </span>
            <span className="score-value text-right text-sm font-semibold">
              {Math.round(p.value * 100)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NavLinks({ id, whyLabel }: { id: number; whyLabel: string }) {
  const { t } = useApp();
  const links = [
    { href: `/field/${id}/why`, label: whyLabel, icon: HelpCircle },
    { href: `/field/${id}/hours`, label: t("hoursTitle"), icon: CalendarClock },
    { href: `/field/${id}/journal`, label: t("openJournal"), icon: BookOpen },
    { href: `/field/${id}/history`, label: t("seasonHistory"), icon: History },
  ];
  return (
    <nav className="grid grid-cols-2 gap-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "flex min-h-[56px] items-center gap-2 rounded-control border border-mist bg-card px-3 py-2 text-sm font-semibold leading-tight",
            "transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--mist)_40%,var(--card))]",
          )}
        >
          <l.icon aria-hidden className="size-4 shrink-0 text-forest" />
          <span>{l.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function ResultSkeleton() {
  return (
    <PhoneFrame backHref="/">
      <div className="space-y-5 p-4" aria-busy="true">
        <Skeleton className="h-[11.5rem] w-full rounded-card" />
        <Skeleton className="h-[9.5rem] w-full rounded-card" />
        <Skeleton className="h-[6.5rem] w-full rounded-card" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-[52px]" />
          <Skeleton className="h-[52px]" />
          <Skeleton className="h-[52px]" />
          <Skeleton className="h-[52px]" />
        </div>
      </div>
    </PhoneFrame>
  );
}
