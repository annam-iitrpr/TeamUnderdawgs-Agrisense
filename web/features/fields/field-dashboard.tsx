"use client";

/**
 * P1-04 — field dashboard, field switching and data requests.
 *
 * The spec's ordering is deliberate and followed here: the next action comes
 * first, the score is secondary, and analytical detail sits behind a tap. Every
 * card names the field and season it belongs to, because several seasons can be
 * active at once.
 *
 * Cross-contamination is the specific hazard this screen has to avoid: a slow
 * response for Field A must never render under Field B's heading. Every query
 * key includes the actor and the field id, and `useApiQuery` both aborts the
 * previous request and discards a late result whose key is no longer current.
 */
import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher, useLanguage } from "@/components/language-provider";
import { Button, Callout, Card, DataModeBadge, EmptyState, ErrorState, Skeleton, UnknownValue } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { InstallAppButton } from "@/features/pwa/pwa-controls";
import { AddSeasonForm } from "@/features/crops/add-season-form";
import { MoistureReadingForm } from "@/features/soil/moisture-reading-form";
import { SoilCardUpload } from "@/features/soil/soil-card-upload";
import { FieldInputsForm } from "./field-inputs-form";
import { RemoveField } from "./remove-field";
import { RequestAdvice } from "./request-advice";
import { SeasonSummaryStrip } from "./season-summary-strip";
import { useCrops } from "@/features/crops/use-crop-name";
import { useApiQuery } from "@/lib/api/query";
import { fields as fieldsApi, seasons as seasonsApi } from "@/lib/api/routes";
import type { Field, Recommendation, Season } from "@/lib/api/contract";
import { formatArea, formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useActiveField } from "./active-field";
import { ChevronDown, Clock, Droplets, Flag, IndianRupee, MapPin, Plus, Sparkles, Sprout } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function FieldDashboard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const fieldsQuery = useApiQuery(
    // Actor-scoped: two accounts must never share a cache entry.
    [uid, "fields"],
    (signal) => fieldsApi.list({ signal, limit: 50 }),
    { enabled: Boolean(uid) },
  );

  const allFields = fieldsQuery.data?.items ?? [];
  const visible = allFields.filter((f) => !f.archived);
  const { activeId, setActiveId } = useActiveField(
    uid,
    visible.map((f) => f.id),
  );
  const active = visible.find((f) => f.id === activeId) ?? null;

  if (fieldsQuery.isLoading) {
    return (
      <AppShell title={t("navHome")}>
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-card" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-48 w-full rounded-card lg:col-span-2" />
            <Skeleton className="h-48 w-full rounded-card" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (fieldsQuery.error) {
    return (
      <AppShell title={t("navHome")}>
        <ErrorState
          title={t("errorTitle")}
          message={fieldsQuery.error.message}
          retryLabel={t("retry")}
          onRetry={fieldsQuery.error.retryable ? fieldsQuery.refetch : undefined}
        />
      </AppShell>
    );
  }

  if (visible.length === 0) {
    return (
      <AppShell title={t("navHome")}>
        <EmptyState
          title="No fields yet"
          message="Register a field and AgriSense can start telling you when to spray, how much water it needs, and what the season is worth."
          action={
            <Link href="/onboarding?add=1">
              <Button size="lg">
                <Plus aria-hidden className="size-4" />
                Add your first field
              </Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      title={active?.name ?? t("navHome")}
      headerActions={
        <>
          <DataModeBadge mode={fieldsQuery.meta?.data_mode} />
          <InstallAppButton className="hidden sm:inline-flex" />
          {/* Mobile and tablet only: the sidebar carries the switcher from lg
              up. Without the lg:hidden this rendered twice on desktop and,
              worse, not at all on mobile — where the sidebar is hidden too. */}
          <LanguageSwitcher className="lg:hidden" />
        </>
      }
    >
      <div className="space-y-4">
        <FieldSwitcher
          fields={visible}
          activeId={activeId}
          onSelect={setActiveId}
          onChanged={() => fieldsQuery.refetch()}
        />
        {active ? (
          <FieldPanel
            key={active.id}
            field={active}
            uid={uid}
            onFieldChanged={() => fieldsQuery.refetch()}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function FieldSwitcher({
  fields,
  activeId,
  onSelect,
  onChanged,
}: {
  fields: Field[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = fields.find((f) => f.id === activeId);

  // With a single field there is nothing to switch between, so the control is
  // a plain summary rather than a menu that does nothing.
  if (fields.length === 1 && active) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <FieldSummary field={active} />
        <div className="flex flex-wrap items-center gap-3">
          <RemoveField field={active} onRemoved={onChanged} compact />
          <Link href="/onboarding?add=1" className="text-sm font-semibold text-forest underline">
            Add another field
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {active ? <FieldSummary field={active} /> : <span className="text-sm">Select a field</span>}
        <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Switch field
          <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
        </Button>
      </div>

      {open ? (
        <ul className="mt-3 space-y-1.5 border-t border-mist pt-3">
          {fields.map((field) => (
            <li key={field.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(field.id);
                  setOpen(false);
                }}
                aria-current={field.id === activeId ? "true" : undefined}
                className={cn(
                  "flex min-h-[52px] w-full items-center justify-between gap-3 rounded-control border px-3 text-left",
                  field.id === activeId
                    ? "border-forest bg-[color-mix(in_srgb,var(--sprout)_10%,transparent)]"
                    : "border-mist bg-card",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{field.name}</span>
                  <span className="block text-xs text-slate">
                    {formatArea(field.area_ha, "ha")}
                  </span>
                </span>
              </button>
              {/* Each field is managed where it is listed, so a farmer does not
                  have to switch to a field just to remove it. */}
              <div className="mt-1.5 pl-1">
                <RemoveField field={field} onRemoved={onChanged} compact />
              </div>
            </li>
          ))}
          <li className="pt-1">
            <Link
              href="/onboarding?add=1"
              className="flex min-h-[48px] items-center gap-2 rounded-control border border-dashed border-mist px-3 text-sm font-semibold text-forest"
            >
              <Plus aria-hidden className="size-4" />
              Add another field
            </Link>
          </li>
        </ul>
      ) : null}
    </Card>
  );
}

function FieldSummary({ field }: { field: Field }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-h3 font-semibold">{field.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate">
        <span>{formatArea(field.area_ha, "ha")}</span>
        <span className="inline-flex items-center gap-1">
          <MapPin aria-hidden className="size-3" />
          {field.centroid.source === "gps" ? "GPS location" : "approximate location"}
        </span>
        {field.irrigation_method ? <span className="capitalize">{field.irrigation_method}</span> : null}
      </p>
    </div>
  );
}

/**
 * Everything scoped to one field.
 *
 * Keyed on the field id by the caller, so switching fields remounts rather than
 * letting the previous field's data linger for a frame under the new heading.
 */
function FieldPanel({
  field,
  uid,
  onFieldChanged,
}: {
  field: Field;
  uid: string | null;
  onFieldChanged: () => void;
}) {
  const { t } = useLanguage();
  const [editingInputs, setEditingInputs] = useState(false);
  const [recordingMoisture, setRecordingMoisture] = useState(false);

  const seasonsQuery = useApiQuery(
    // field id in the key: this is the Field A / Field B isolation guarantee.
    [uid, "seasons", field.id, field.version],
    (signal) => fieldsApi.seasons(field.id, { signal, limit: 20 }),
    { enabled: Boolean(uid) },
  );

  const seasons = seasonsQuery.data?.items ?? [];
  const activeSeasons = seasons.filter((s) => s.status !== "closed");
  // Closed seasons used to vanish from the app entirely, which made the
  // forecast-against-actual review unreachable the moment it became possible.
  const pastSeasons = seasons.filter((s) => s.status === "closed");

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {seasonsQuery.isLoading ? (
          <Skeleton className="h-44 w-full rounded-card" />
        ) : seasonsQuery.error ? (
          <ErrorState
            title="Could not load this field's seasons"
            message={seasonsQuery.error.message}
            retryLabel={t("retry")}
            onRetry={seasonsQuery.error.retryable ? seasonsQuery.refetch : undefined}
          />
        ) : activeSeasons.length === 0 ? (
          <NoSeasonCard field={field} onAdded={() => seasonsQuery.refetch()} />
        ) : (
          activeSeasons.map((season) => (
            <SeasonCard key={season.id} field={field} season={season} />
          ))
        )}

        {pastSeasons.length > 0 ? <PastSeasons seasons={pastSeasons} /> : null}
      </div>

      <div className="space-y-4">
        <DataRequests
          field={field}
          seasonCount={activeSeasons.length}
          onEditInputs={() => setEditingInputs(true)}
          onRecordMoisture={() => setRecordingMoisture(true)}
        />
        {recordingMoisture ? (
          <MoistureReadingForm
            field={field}
            onSaved={() => {
              setRecordingMoisture(false);
              onFieldChanged();
            }}
            onCancel={() => setRecordingMoisture(false)}
          />
        ) : null}
        {editingInputs ? (
          <FieldInputsForm
            field={field}
            onSaved={() => {
              setEditingInputs(false);
              onFieldChanged();
            }}
            onCancel={() => setEditingInputs(false)}
          />
        ) : null}
        {field.soil_summary == null ? (
          <SoilCardUpload field={field} onSaved={onFieldChanged} />
        ) : null}
        <Shortcuts />
        <RemoveField field={field} onRemoved={onFieldChanged} />
      </div>
    </div>
  );
}

function NoSeasonCard({
  field,
  onAdded,
}: {
  field: Field;
  onAdded: (season?: Season) => void;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate">{field.name}</p>
      <h2 className="mt-1 text-h2 font-semibold">No crop set for this field</h2>
      <p className="mt-2 text-sm text-slate">
        A spray window, a water plan and a return estimate all depend on knowing the crop and when
        it was sown. Nothing can be calculated for this field until then.
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/plan-crop?field=${encodeURIComponent(field.id)}`}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-control bg-forest px-4 text-sm font-semibold text-white"
          >
            <Sparkles aria-hidden className="size-4" />
            Suggest crops for this field
          </Link>
        </div>
        <details className="rounded-card border border-mist p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            I already know which crop
          </summary>
          <p className="mt-1 text-xs text-slate">
            Adds the crop straight away. Water, suitability and return are shown on the
            suggestions screen.
          </p>
          <div className="mt-3">
            <AddSeasonForm field={field} existingSeasons={[]} onAdded={onAdded} />
          </div>
        </details>
      </div>

    </Card>
  );
}

/**
 * The primary card once a season exists.
 *
 * The crop name comes from the catalogue and the recommendation from the engine.
 * Neither is invented here: an absent name shows the id, and an absent or
 * insufficient recommendation says so rather than rendering an empty score,
 * which would read as "no risk" instead of "not known".
 */
function SeasonCard({ field, season }: { field: Field; season: Season }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const { cropFor } = useCrops();
  const crop = cropFor(season.crop_id);

  const recommendationQuery = useApiQuery(
    [uid, "season", season.id, "recommendation"],
    (signal) => seasonsApi.latestRecommendation(season.id, { signal }),
    { enabled: Boolean(uid) },
  );
  const recommendation = recommendationQuery.data ?? null;
  // A 409 here is RECOMMENDATION_EXPIRED: the season *was* evaluated and the
  // advice has aged out. Reporting that as "no evaluation yet" tells a farmer
  // the opposite of what happened, and hides the fact that a refresh will fix it.
  const expired = recommendationQuery.error?.status === 409;

  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate">
        {field.name} · {season.status}
      </p>
      <h2 className="mt-1 break-words text-h2 font-semibold capitalize">
        {crop?.name ?? season.crop_id}
      </h2>
      {crop && !crop.supported_for_biological_advice ? (
        <p className="mt-0.5 text-xs text-slate">
          Planning only. Biological product advice is not supported for this crop.
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Fact label="Sown">
          {season.sowing_date ? (
            <>
              {formatDateShort(`${season.sowing_date}T00:00:00Z`)}
              {season.date_confidence !== "confirmed" ? (
                <span className="ml-1 text-xs text-slate">({season.date_confidence})</span>
              ) : null}
            </>
          ) : (
            <UnknownValue label="Not known" />
          )}
        </Fact>
        <Fact label="Stage">
          {recommendation?.stage ?? season.stage ? (
            <>
              <span className="capitalize">
                {(recommendation?.stage ?? season.stage ?? "").replace(/_/g, " ")}
              </span>
              <span className="ml-1 text-xs text-slate">({season.stage_source})</span>
            </>
          ) : (
            <UnknownValue label="Not known" />
          )}
        </Fact>
        <Fact label="Area">{formatArea(season.allocated_area_ha, "ha")}</Fact>
      </dl>

      <RecommendationBlock
        loading={recommendationQuery.isLoading}
        recommendation={recommendation}
        expired={expired}
      />

      {/* Nothing else in the app asked for an evaluation, so a farmer who had
          entered everything correctly saw empty figures everywhere. Offered
          when there is no advice, or when what there is has aged out. */}
      {season.status !== "closed" && (recommendation == null || expired) ? (
        <RequestAdvice
          seasonId={season.id}
          expectedVersion={season.version}
          expired={expired}
          onEvaluated={() => void recommendationQuery.refetch()}
        />
      ) : null}

      {/* Water, money and risk at a glance. Each has its own screen; what was
          missing was seeing where the season stands without navigating three
          times. Only for open seasons — a closed one is reviewed, not managed. */}
      {season.status !== "closed" ? (
        <SeasonSummaryStrip
          seasonId={season.id}
          areaHa={season.allocated_area_ha}
          recommendation={recommendation}
          adviceExpired={expired}
        />
      ) : null}

      {/* The views that explain the season, reachable from the season they
          belong to rather than from a global menu. Readiness leads because it
          is the only one that answers "what do I do today". */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-mist pt-4">
        <Link
          href={`/readiness?season=${encodeURIComponent(season.id)}`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-mist px-3 text-sm font-semibold text-ink"
        >
          <Clock aria-hidden className="size-4 text-forest" />
          When to go out
        </Link>
        <Link
          href={`/money?season=${encodeURIComponent(season.id)}`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-mist px-3 text-sm font-semibold text-ink"
        >
          <IndianRupee aria-hidden className="size-4 text-forest" />
          Money
        </Link>
        <Link
          href={`/water?season=${encodeURIComponent(season.id)}`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-mist px-3 text-sm font-semibold text-ink"
        >
          <Droplets aria-hidden className="size-4 text-forest" />
          Water
        </Link>
        {/* Ending the season sits with the season, not in a settings menu, and
            is styled as an ordinary action rather than a destructive one: it is
            the normal end of a season, and nothing is deleted by it. */}
        <Link
          href={`/close-season?season=${encodeURIComponent(season.id)}`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-mist px-3 text-sm font-semibold text-ink"
        >
          <Flag aria-hidden className="size-4 text-forest" />
          {season.status === "closed" ? "How it went" : "End season"}
        </Link>
      </div>
    </Card>
  );
}

/**
 * What the engine actually concluded.
 *
 * `insufficient_data` is a real, meaningful outcome and is shown as one: the
 * forecast was fetched and the stress computed, and the engine still declined
 * to advise. That is different from the service being down, and different
 * again from a zero score.
 */
function RecommendationBlock({
  loading,
  recommendation,
  expired,
}: {
  expired?: boolean;
  loading: boolean;
  recommendation: Recommendation | null;
}) {
  if (loading) return <Skeleton className="mt-4 h-20 w-full rounded-card" />;

  if (!recommendation) {
    return expired ? (
      <Callout tone="caution" className="mt-4" title="The advice has expired">
        This season was evaluated, but the weather it was based on has moved on, so the advice
        no longer stands. Nothing is wrong — it just needs working out again.
      </Callout>
    ) : (
      <Callout tone="info" className="mt-4" title="No advice worked out yet">
        Nobody has asked AgriSense to evaluate this season, so there is no readiness score. An
        empty score would read as &ldquo;no risk&rdquo;, which is a different claim from
        &ldquo;not known&rdquo;.
      </Callout>
    );
  }

  const reasons = recommendation.reasons ?? [];

  if (recommendation.status === "insufficient_data") {
    return (
      <Callout tone="caution" className="mt-4" title="Not enough information to advise">
        <p>
          The weather was read and the crop stress worked out, but AgriSense will not name a
          spray window without reviewed agronomic records for this crop and a confirmed product.
        </p>
        {reasons.length ? (
          <ul className="mt-2 list-inside list-disc text-sm">
            {reasons.slice(0, 3).map((reason) => (
              <li key={reason.code}>{reason.code.replace(/_/g, " ")}</li>
            ))}
          </ul>
        ) : null}
      </Callout>
    );
  }

  const tone =
    recommendation.status === "recommended"
      ? "success"
      : recommendation.status === "blocked"
        ? "blocked"
        : "info";

  return (
    <Callout tone={tone} className="mt-4" title={recommendation.status.replace(/_/g, " ")}>
      {recommendation.readiness != null ? (
        <p className="text-sm">
          Readiness <span className="font-semibold">{Math.round(recommendation.readiness)}</span>
          /100
        </p>
      ) : (
        <p className="text-sm">Readiness is not known for this window.</p>
      )}
      {recommendation.selected_window ? (
        <p className="mt-1 text-sm">
          Window {formatDateShort(recommendation.selected_window.start_at)} to{" "}
          {formatDateShort(recommendation.selected_window.end_at)}
        </p>
      ) : null}
      {reasons.length ? (
        <ul className="mt-2 list-inside list-disc text-sm">
          {reasons.slice(0, 3).map((reason) => (
            <li key={reason.code}>{reason.code.replace(/_/g, " ")}</li>
          ))}
        </ul>
      ) : null}
    </Callout>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink">{children}</dd>
    </div>
  );
}

/**
 * Seasons that have ended, and the way back to how each one went.
 *
 * Kept deliberately quiet — this is history, not something needing attention —
 * but present, because the forecast-against-actual review is the only place a
 * farmer can judge whether the advice was worth following, and it only exists
 * once a season is closed.
 */
function PastSeasons({ seasons }: { seasons: Season[] }) {
  const { nameFor } = useCrops();
  return (
    <Card className="p-4">
      <h3 className="text-h3 font-semibold">Seasons you have finished</h3>
      <p className="mt-1 text-xs text-slate">
        How each one actually turned out, and how the advice compared.
      </p>
      <ul className="mt-3 space-y-2">
        {seasons.map((season) => (
          <li key={season.id}>
            <Link
              href={`/close-season?season=${encodeURIComponent(season.id)}`}
              className="flex min-h-[48px] items-center justify-between gap-2 rounded-control border border-mist bg-card px-3 text-sm"
            >
              <span>
                <span className="font-semibold text-ink">{nameFor(season.crop_id)}</span>
                <span className="block text-xs text-slate">
                  {season.sowing_date
                    ? `sown ${formatDateShort(season.sowing_date)}`
                    : "sowing date not recorded"}
                  {" · "}
                  {season.allocated_area_ha} ha
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-forest">How it went</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Actionable requests for information the engine is missing.
 *
 * The spec requires these to open the relevant form and to disappear only once
 * the value is confirmed as persisted. Each one below either links somewhere
 * real or states why it cannot yet — none is a decorative badge.
 */
function DataRequests({
  field,
  seasonCount,
  onEditInputs,
  onRecordMoisture,
}: {
  field: Field;
  seasonCount: number;
  onEditInputs: () => void;
  onRecordMoisture: () => void;
}) {
  const requests: Array<{
    label: string;
    detail?: string;
    href?: string;
    onClick?: () => void;
    blocked?: string;
  }> = [];

  if (seasonCount === 0) {
    requests.push({
      label: "Add the crop for this field",
      href: `/plan-crop?field=${encodeURIComponent(field.id)}`,
    });
  }

  // These three are edited in place against this field. They used to link to
  // /onboarding, which starts a *new* field — so tapping the request could
  // never satisfy it, and the pill stayed forever.
  if (field.available_water_m3 == null || field.water_budget_inr == null) {
    requests.push({
      label: "Say what you can spend on a season",
      detail: "Water and money. Crops cannot be compared without both.",
      onClick: onEditInputs,
    });
  }
  if (field.irrigation_method == null) {
    requests.push({ label: "Say how you water this field", onClick: onEditInputs });
  }
  // Always offered, not only when absent: a water plan needs *today's* reading,
  // so yesterday's does not satisfy this and the request cannot be "done".
  requests.push({
    label: "Add today's soil moisture reading",
    detail: "Needed before AgriSense can say how much water your crop needs.",
    onClick: onRecordMoisture,
  });
  // Soil is handled inline by its own card below, not as a link to somewhere else.
  if (field.centroid.source !== "gps") {
    requests.push({
      label: "Set an exact field location",
      blocked:
        "This field was placed from a village or pincode. An exact position needs to be set from the field itself, on a phone with location switched on.",
    });
  }

  if (requests.length === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-h3 font-semibold">Nothing missing</h3>
        <p className="mt-1.5 text-sm text-slate">
          AgriSense has everything it needs from you for this field.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="text-h3 font-semibold">Help AgriSense help you</h3>
      <p className="mt-1 text-xs text-slate">
        Each of these makes the advice for this field more specific.
      </p>
      <ul className="mt-3 space-y-2">
        {requests.map((request) => (
          <li key={request.label}>
            {request.href ? (
              <Link
                href={request.href}
                className="flex min-h-[48px] items-center justify-between gap-2 rounded-control border border-mist bg-card px-3 text-sm font-semibold"
              >
                <span>{request.label}</span>
                <Plus aria-hidden className="size-4 shrink-0 text-forest" />
              </Link>
            ) : request.onClick ? (
              <button
                type="button"
                onClick={request.onClick}
                className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-control border border-mist bg-card px-3 text-left text-sm font-semibold"
              >
                <span>
                  {request.label}
                  {request.detail ? (
                    <span className="mt-0.5 block text-xs font-normal text-slate">
                      {request.detail}
                    </span>
                  ) : null}
                </span>
                <Plus aria-hidden className="size-4 shrink-0 text-forest" />
              </button>
            ) : (
              <div className="rounded-control border border-dashed border-mist px-3 py-2.5">
                <p className="text-sm font-semibold text-slate">{request.label}</p>
                <p className="mt-0.5 text-xs text-slate">{request.blocked}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Shortcuts() {
  const { t } = useLanguage();
  const links = [
    { href: "/journal", label: t("navJournal"), icon: Sprout },
    { href: "/plan", label: t("navPlan"), icon: Sprout },
    { href: "/ask", label: t("navAsk"), icon: Sprout },
  ];
  return (
    <Card className="p-4">
      <h3 className="text-h3 font-semibold">Go to</h3>
      <ul className="mt-3 grid grid-cols-1 gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex min-h-[48px] items-center gap-2 rounded-control border border-mist bg-card px-3 text-sm font-semibold"
            >
              <link.icon aria-hidden className="size-4 shrink-0 text-forest" />
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
