"use client";

/**
 * P1-05 — is this a good morning to go out, and why.
 *
 * The window comes first and the score second. A farmer is deciding whether to
 * walk into the field; a large readiness number with no time attached does not
 * help them decide anything.
 *
 * Need, timing and viability are shown apart rather than blended. They fail for
 * different reasons and the fix differs: "the crop does not need it" means wait,
 * "the weather will not carry it" means go on a different day. A single averaged
 * score hides which of those is true. Any of them being unknown is drawn as
 * unknown, never as an empty bar, because an empty bar reads as "no risk".
 */
import { AppShell } from "@/components/app-shell";
import {
  Callout,
  Card,
  DataModeBadge,
  ErrorState,
  Skeleton,
  UnknownValue,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { ScoreMeter } from "@/features/planning/score-meter";
import type {
  ForecastBundle,
  Interval,
  ProductFit,
  Recommendation,
  SafetyCheck,
  StressOnset,
} from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/query";
import { seasons as seasonsApi } from "@/lib/api/routes";
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  MessageCircleQuestion,
  NotebookPen,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { StressCurve } from "./stress-curve";

const IST = "Asia/Kolkata";

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: IST,
  });
}

function windowLabel(interval: Interval): string {
  const day = new Date(interval.start_at).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: IST,
  });
  return `${day}, ${clockTime(interval.start_at)} to ${clockTime(interval.end_at)}`;
}

/** Whole hours, rounded down, so a 118-minute window is never called "2 hours". */
function windowHours(interval: Interval): string {
  const minutes = Math.round(
    (Date.parse(interval.end_at) - Date.parse(interval.start_at)) / 60000,
  );
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours}h ${rest}m`;
}

function humanise(code: string): string {
  return code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function ReadinessScreen({ seasonId }: { seasonId: string }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const query = useApiQuery(
    [uid, "season", seasonId, "recommendation"],
    (signal) => seasonsApi.latestRecommendation(seasonId, { signal }),
    { enabled: Boolean(uid) },
  );

  // The forecast is fetched separately and is allowed to fail on its own: it
  // supplies the freshness line, not the advice, so losing it must not blank
  // the window a farmer came here to read.
  const forecastQuery = useApiQuery(
    [uid, "season", seasonId, "forecast"],
    (signal) => seasonsApi.forecast(seasonId, { signal }),
    { enabled: Boolean(uid) },
  );

  const recommendation: Recommendation | null = query.data ?? null;

  return (
    <AppShell
      title="When to go out"
      headerActions={<DataModeBadge mode={query.meta?.data_mode} />}
    >
      <div className="space-y-4">
        {query.isLoading ? (
          <>
            <Skeleton className="h-48 w-full rounded-card" />
            <Skeleton className="h-32 w-full rounded-card" />
          </>
        ) : query.error ? (
          query.error.isDependencyUnavailable || query.error.status === 404 ? (
            <NotEvaluated seasonId={seasonId} />
          ) : (
            <ErrorState title="Could not load this" message={query.error.message} />
          )
        ) : recommendation ? (
          <Detail
            recommendation={recommendation}
            forecast={forecastQuery.data ?? null}
            seasonId={seasonId}
          />
        ) : (
          <NotEvaluated seasonId={seasonId} />
        )}
      </div>
    </AppShell>
  );
}

function Detail({
  recommendation,
  forecast,
  seasonId,
}: {
  recommendation: Recommendation;
  forecast: ForecastBundle | null;
  seasonId: string;
}) {
  const expired = Date.parse(recommendation.expires_at) <= Date.now();
  const blocked = recommendation.status === "blocked";
  const insufficient = recommendation.status === "insufficient_data";
  const failedChecks = (recommendation.safety_checks ?? []).filter(
    (check) => check.status === "failed",
  );

  return (
    <>
      {recommendation.superseded ? (
        <Callout tone="caution" title="Newer advice exists">
          This evaluation has been replaced by a later one. It is kept so you can see what was
          said at the time.
        </Callout>
      ) : null}

      {expired ? (
        <Callout tone="caution" title="This advice has expired">
          The weather it was built on has moved on since{" "}
          {new Date(recommendation.generated_at).toLocaleString("en-IN", { timeZone: IST })}. Run
          the season again before acting on it.
        </Callout>
      ) : null}

      {/* The decision. */}
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate">
          {recommendation.stage ? `${humanise(recommendation.stage)} · ` : ""}
          {humanise(recommendation.status)}
        </p>

        {recommendation.selected_window ? (
          <>
            <p className="mt-1 flex items-start gap-2 text-h2 font-semibold text-ink">
              <Clock aria-hidden className="mt-1 size-5 shrink-0 text-forest" />
              <span>{windowLabel(recommendation.selected_window)}</span>
            </p>
            <p className="mt-1 text-sm text-slate">
              That is {windowHours(recommendation.selected_window)} of workable weather. Outside
              it the conditions do not hold.
            </p>

            {recommendation.alternative_windows &&
            recommendation.alternative_windows.length > 0 ? (
              <div className="mt-3 border-t border-mist pt-3">
                <p className="text-xs font-semibold text-slate">If you cannot make that one</p>
                <ul className="mt-1 space-y-1 text-sm text-ink">
                  {recommendation.alternative_windows.slice(0, 3).map((w) => (
                    <li key={w.start_at} className="flex flex-wrap items-baseline gap-x-2">
                      <span>{windowLabel(w)}</span>
                      <span className="text-xs text-slate">{windowHours(w)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-1 flex items-start gap-2 text-h3 font-semibold text-ink">
              <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-ink" />
              <span>
                {insufficient
                  ? "No window can be named yet"
                  : blocked
                    ? "Do not go out on this advice"
                    : "No suitable window in the days ahead"}
              </span>
            </p>
            <p className="mt-1 text-sm text-slate">
              {insufficient
                ? "AgriSense does not have enough about this field and crop to pick a time. It will not guess one."
                : blocked
                  ? "A safety check failed. The reasons are listed below."
                  : "Every hour in the forecast fails at least one condition. Check again once the forecast moves."}
            </p>
          </>
        )}

        <div className="mt-4 grid gap-4 border-t border-mist pt-4 sm:grid-cols-3">
          <ScoreMeter score={recommendation.need} label="Does the crop need it" />
          <ScoreMeter score={recommendation.timing_fit} label="Is now the right time" />
          <ScoreMeter score={recommendation.viability} label="Will the weather carry it" />
        </div>

        <div className="mt-4 border-t border-mist pt-4">
          {recommendation.readiness != null ? (
            // The contract carries readiness as 0-100 while the three parts are
            // 0-1, so it is scaled here rather than drawn on a different axis.
            <ScoreMeter score={recommendation.readiness / 100} label="Overall readiness" />
          ) : (
            <>
              <p className="text-xs font-semibold text-slate">Overall readiness</p>
              <div className="mt-1">
                <UnknownValue label="Not known" />
              </div>
              <p className="mt-0.5 text-xs text-slate">
                One of the three parts above is missing, so there is no overall figure.
              </p>
            </>
          )}
        </div>
      </Card>

      {failedChecks.length > 0 ? (
        <Callout tone="blocked" title="Why you should not go out">
          <ul className="space-y-1">
            {failedChecks.map((check) => (
              <li key={check.code}>
                {humanise(check.code)} — {humanise(check.reason.code)}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {recommendation.reasons.length > 0 ? (
        <Card className="p-4">
          <p className="text-sm font-semibold text-ink">
            {recommendation.selected_window ? "Why this window" : "Why there is no window"}
          </p>
          <ul className="mt-2 space-y-2">
            {recommendation.reasons.map((reason) => (
              <li key={reason.code} className="flex gap-2 text-sm">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-forest" />
                <span>
                  <span className="text-ink">{humanise(reason.code)}</span>
                  {reason.facts && Object.keys(reason.facts).length > 0 ? (
                    <span className="block text-xs text-slate">
                      {Object.entries(reason.facts)
                        .map(([key, value]) => `${humanise(key).toLowerCase()} ${value ?? "unknown"}`)
                        .join(" · ")}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {recommendation.safety_checks && recommendation.safety_checks.length > 0 ? (
        <Card className="p-4">
          <p className="text-sm font-semibold text-ink">Safety checks</p>
          <ul className="mt-2 space-y-2">
            {recommendation.safety_checks.map((check) => (
              <SafetyRow key={check.code} check={check} />
            ))}
          </ul>
        </Card>
      ) : null}

      {recommendation.product_fit ? (
        <ProductFitCard fit={recommendation.product_fit} />
      ) : null}

      <Card className="p-4">
        <p className="text-sm font-semibold text-ink">The days ahead</p>
        <p className="mt-0.5 text-xs text-slate">
          How much stress the crop is projected to be under, by kind of stress.
        </p>
        <div className="mt-3">
          <StressCurve points={recommendation.stress_curve ?? []} />
        </div>
        {recommendation.stress_onsets && recommendation.stress_onsets.length > 0 ? (
          <div className="mt-4 border-t border-mist pt-3">
            <p className="text-xs font-semibold text-slate">When each one starts</p>
            <ul className="mt-1.5 space-y-1">
              {recommendation.stress_onsets.map((onset) => (
                <OnsetRow key={`${onset.stress_type}-${onset.local_date ?? "none"}`} onset={onset} />
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Actions seasonId={seasonId} />

      <Provenance recommendation={recommendation} forecast={forecast} />
    </>
  );
}

function SafetyRow({ check }: { check: SafetyCheck }) {
  const icon =
    check.status === "passed" ? (
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-forest" />
    ) : check.status === "failed" ? (
      <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-clay" />
    ) : (
      <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0 text-slate" />
    );
  return (
    <li className="flex gap-2 text-sm">
      {icon}
      <span>
        <span className="text-ink">{humanise(check.code)}</span>
        <span className="block text-xs text-slate">
          {check.status === "unknown"
            ? "Could not be checked — treat this as not cleared, not as cleared"
            : check.status === "not_applicable"
              ? "Does not apply to this field"
              : humanise(check.reason.code)}
        </span>
      </span>
    </li>
  );
}

function OnsetRow({ onset }: { onset: StressOnset }) {
  const date = onset.local_date;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-ink">{humanise(onset.stress_type)}</span>
      {date ? (
        <span className="text-slate">
          from{" "}
          {new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
            weekday: "short",
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          })}
        </span>
      ) : (
        <UnknownValue
          label="no start date"
          reason={onset.reason ? humanise(onset.reason).toLowerCase() : undefined}
        />
      )}
    </li>
  );
}

function ProductFitCard({ fit }: { fit: ProductFit }) {
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold text-ink">Is the product right for this</p>
      <p
        className={`mt-1 inline-flex items-center gap-1.5 text-sm font-semibold ${
          fit.eligible ? "text-forest" : "text-clay"
        }`}
      >
        {fit.eligible ? (
          <CircleCheck aria-hidden className="size-4" />
        ) : (
          <CircleX aria-hidden className="size-4" />
        )}
        {fit.eligible ? "Cleared for this crop and stage" : "Not cleared for this use"}
      </p>
      {fit.reasons.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-slate">
          {fit.reasons.map((reason) => (
            <li key={reason.code}>{humanise(reason.code)}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-slate">
        This reflects the product label, not a recommendation to buy anything.
      </p>
    </Card>
  );
}

function Actions({ seasonId }: { seasonId: string }) {
  const link =
    "inline-flex min-h-[44px] items-center gap-2 rounded-control px-3 text-sm font-semibold";
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold text-ink">What do you want to do?</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/journal?season=${encodeURIComponent(seasonId)}`}
          className={`${link} bg-forest text-white`}
        >
          <NotebookPen aria-hidden className="size-4" />I did this
        </Link>
        <Link
          href={`/plan?season=${encodeURIComponent(seasonId)}`}
          className={`${link} border border-mist text-ink`}
        >
          <Clock aria-hidden className="size-4 text-forest" />
          See it in my plan
        </Link>
        <Link href="/ask" className={`${link} border border-mist text-ink`}>
          <MessageCircleQuestion aria-hidden className="size-4 text-forest" />
          Ask about this
        </Link>
      </div>
      <p className="mt-2 text-xs text-slate">
        Recording that you did something asks when you actually did it. AgriSense does not assume
        you went out at the time it suggested — the difference between the two is what the
        forecast is later scored against.
      </p>
    </Card>
  );
}

function Provenance({
  recommendation,
  forecast,
}: {
  recommendation: Recommendation;
  forecast: ForecastBundle | null;
}) {
  const sources = (recommendation.forecast_provenance ?? []).map((p) => p.source);
  return (
    <p className="text-xs leading-relaxed text-slate">
      Worked out {new Date(recommendation.generated_at).toLocaleString("en-IN", { timeZone: IST })}
      , good until {new Date(recommendation.expires_at).toLocaleString("en-IN", { timeZone: IST })}.
      {sources.length > 0 ? ` Weather from ${[...new Set(sources)].join(", ")}.` : ""}
      {forecast
        ? ` Forecast read ${new Date(forecast.retrieved_at).toLocaleString("en-IN", { timeZone: IST })} from ${forecast.provider}${
            forecast.grid_resolution_km
              ? `, on a ${forecast.grid_resolution_km} km grid rather than your exact field`
              : ""
          }.`
        : ""}{" "}
      Rule version {recommendation.rule_version}
      {recommendation.model_version ? `, model ${recommendation.model_version}` : ""}.
    </p>
  );
}

function NotEvaluated({ seasonId }: { seasonId: string }) {
  return (
    <Callout tone="caution" title="This season has not been evaluated yet">
      <p>
        Naming a window needs a forecast for your field and reviewed agronomic records for the
        crop. AgriSense will not name a morning without both — being wrong about that costs a
        tank of product and a day of work.
      </p>
      <Link
        href={`/journal?season=${encodeURIComponent(seasonId)}`}
        className="mt-2 inline-block text-sm font-semibold text-forest underline"
      >
        Record what you have been doing meanwhile
      </Link>
    </Callout>
  );
}
