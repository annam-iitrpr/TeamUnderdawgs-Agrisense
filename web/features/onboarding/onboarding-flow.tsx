"use client";

/**
 * P1-02 — progressive onboarding and field setup.
 *
 * Follows the PRD's two-branch journey: language and consent, then location,
 * then land, then either "I already have a crop" or "help me choose", then the
 * soil card, then a review that saves once.
 *
 * Principles that shaped the details:
 *  - Only consent, location and area are required. Crop and soil are deferrable
 *    and produce a visible data request instead of blocking, because a farmer
 *    who does not have a soil card to hand must still be able to finish.
 *  - A pincode or village centroid is never presented as the field's real
 *    position; it is labelled approximate and carries a different
 *    `Location.source`.
 *  - The normalised area is echoed back so a unit slip is visible immediately.
 *  - Save uses the draft's idempotency key, so a retry cannot create a second
 *    field.
 */
import { LanguageSwitcher, useLanguage } from "@/components/language-provider";
import { Button, Callout, Card, Skeleton, TextField } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError } from "@/lib/api/envelope";
import { catalog as catalogApi, fields as fieldsApi } from "@/lib/api/routes";
import { newIdempotencyKey } from "@/lib/api/client";
import type { AreaUnit, Crop, LocationResult, LocationSource } from "@/lib/api/contract";
import { AMBIGUOUS_UNITS, AREA_UNITS, parseArea, roundHectares } from "@/lib/area";
import { formatArea } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCrops } from "@/features/crops/use-crop-name";
import { CropCard } from "@/features/planning/crop-card";
import { NoCandidates } from "@/features/planning/no-candidates";
import {
  MAX_CANDIDATES,
  useAutoComparison,
  waterScores,
} from "@/features/planning/use-comparison";
import {
  canAdvance,
  clearDraft,
  loadDraft,
  newDraft,
  saveDraft,
  STEPS,
  type OnboardingDraft,
  type StepId,
} from "./draft";
import { Check, ChevronLeft, Loader2, MapPin, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STEP_TITLE: Record<StepId, string> = {
  consent: "Welcome",
  location: "Where is your field?",
  land: "How much land?",
  crop: "Which crop?",
  soil: "Soil test",
  review: "Check and save",
};

export function OnboardingFlow() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const uid = user?.uid ?? null;

  const searchParams = useSearchParams();
  const addingAnother = searchParams.get("add") === "1";
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Restore an interrupted onboarding, or start a fresh one. The idempotency
  // key is minted here, once, and then lives in the draft.
  //
  // A farmer adding a second field has already agreed to all of this. Asking
  // again reads as a wall in front of a routine action, so the consent step is
  // skipped and recorded as already given when they arrive with ?add=1.
  useEffect(() => {
    if (!uid) return;
    const existing = loadDraft(uid);
    if (existing) {
      setDraft(existing);
      setRestored(true);
      return;
    }
    const fresh = newDraft(newIdempotencyKey());
    if (addingAnother) {
      fresh.consents = { service: true, modelLearning: false, notifications: false };
      fresh.step = STEPS.indexOf("location");
    }
    setDraft(fresh);
  }, [uid, addingAnother]);

  const update = useCallback(
    (mutate: (d: OnboardingDraft) => void) => {
      setDraft((current) => {
        if (!current) return current;
        const next = structuredClone(current);
        mutate(next);
        if (uid) saveDraft(uid, next);
        return next;
      });
    },
    [uid],
  );

  const step = STEPS[draft?.step ?? 0] ?? "consent";
  const stepIndex = draft?.step ?? 0;

  const goNext = useCallback(() => {
    update((d) => {
      d.step = Math.min(d.step + 1, STEPS.length - 1);
    });
  }, [update]);

  /**
   * Leaving the land step saves the field before moving on; a failure holds the
   * farmer on the step with the error rather than sending them to a crop
   * comparison that has no field to compare against.
   */
  async function advance() {
    if (step === "land" && !draft?.fieldId) {
      const fieldId = await ensureField();
      if (!fieldId) return;
    }
    goNext();
  }

  const goBack = useCallback(() => {
    update((d) => {
      d.step = Math.max(d.step - 1, 0);
    });
  }, [update]);

  const area = useMemo(() => {
    if (!draft) return null;
    return parseArea(draft.land.enteredArea, draft.land.unit);
  }, [draft]);

  /**
   * Saves the field, once, as the farmer leaves the land step.
   *
   * This used to happen at the very end. It had to move: the crop step now
   * shows what each crop would actually do on *this* field — compatibility,
   * water, yield and return — and the engine scores a crop against a field id.
   * There is nothing to score against until the field exists.
   *
   * Calling it twice is safe. The draft's idempotency key is reused rather than
   * minted per attempt, so a timeout followed by a retry resolves to the same
   * field instead of creating a second one, and the id is remembered in the
   * draft so a reload does not create another.
   */
  const ensureField = useCallback(async (): Promise<string | null> => {
    if (!draft || !uid || !area?.ok) return null;
    if (draft.fieldId) return draft.fieldId;
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await fieldsApi.create(
        {
          name: draft.land.name.trim(),
          area_ha: roundHectares(area.areaHa),
          entered_area: area.enteredArea,
          entered_area_unit: area.unit,
          centroid: {
            latitude: draft.location.latitude!,
            longitude: draft.location.longitude!,
            precision_m: draft.location.precisionM,
            source: (draft.location.source ?? "manual") as LocationSource,
          },
          irrigation_method: draft.land.irrigationMethod,
        },
        // The draft's key, not a fresh one: this is what makes a retry safe.
        draft.idempotencyKey,
      );
      update((d) => void (d.fieldId = data.id));
      return data.id;
    } catch (error) {
      if (error instanceof ApiError) {
        setSaveError(
          error.isDependencyUnavailable
            ? "AgriSense cannot save your field right now because a service it depends on is unavailable. Your answers are kept — try again in a moment."
            : error.message,
        );
      } else {
        setSaveError(t("errorUnreachable"));
      }
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, uid, area, update, t]);

  /**
   * Finishes onboarding.
   *
   * By this point the field already exists and any chosen crop already has a
   * season, so this creates nothing — it clears the draft and hands over to the
   * dashboard. It still calls `ensureField` because a farmer can reach the
   * review step without the land-step save having succeeded.
   */
  async function save() {
    if (!draft || !uid) return;
    const fieldId = draft.fieldId ?? (await ensureField());
    if (!fieldId) return;
    clearDraft(uid);
    router.replace(`/?field=${encodeURIComponent(fieldId)}`);
  }

  if (!draft) {
    return (
      <div className="mx-auto max-w-[34rem] px-4 py-8" aria-busy="true">
        <Loader2 aria-hidden className="mx-auto size-6 animate-spin text-forest" />
        <p className="mt-2 text-center text-sm text-slate">{t("loading")}</p>
      </div>
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[34rem] px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-h3 font-semibold text-forest">{t("appName")}</p>
          <p className="text-xs text-slate">{t("tagline")}</p>
        </div>
        <LanguageSwitcher />
      </div>

      <ProgressRail index={stepIndex} />

      {restored && stepIndex > 0 ? (
        <Callout tone="info" className="mt-4 text-sm">
          We kept what you had already entered.
        </Callout>
      ) : null}

      <h1 className="mt-5 text-h1 font-semibold">{STEP_TITLE[step]}</h1>

      <div className="mt-4">
        {step === "consent" ? <ConsentStep draft={draft} update={update} /> : null}
        {step === "location" ? <LocationStep draft={draft} update={update} /> : null}
        {step === "land" ? (
          <LandStep draft={draft} update={update} area={area} />
        ) : null}
        {step === "crop" ? (
          <CropStep draft={draft} update={update} areaHa={area?.ok ? area.areaHa : null} />
        ) : null}
        {step === "soil" ? <SoilStep draft={draft} update={update} /> : null}
        {step === "review" ? <ReviewStep draft={draft} area={area} /> : null}
      </div>

      {saveError ? (
        <Callout tone="blocked" className="mt-4 text-sm" title={t("errorTitle")}>
          {saveError}
        </Callout>
      ) : null}

      <div className="mt-6 flex items-center gap-2">
        {stepIndex > 0 ? (
          <Button variant="secondary" onClick={goBack} disabled={saving}>
            <ChevronLeft aria-hidden className="size-4" />
            {t("back")}
          </Button>
        ) : null}

        {step === "review" ? (
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void save()}
            busy={saving}
            busyLabel="Saving your field"
            disabled={!canAdvance("review", draft)}
          >
            {t("save")}
          </Button>
        ) : (
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void advance()}
            busy={saving}
            busyLabel="Saving your field"
            disabled={!canAdvance(step, draft)}
          >
            {t("next")}
          </Button>
        )}
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────── steps */

function ProgressRail({ index }: { index: number }) {
  return (
    <ol className="mt-5 flex gap-1.5" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      {STEPS.map((id, i) => (
        <li
          key={id}
          aria-current={i === index ? "step" : undefined}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            i < index ? "bg-sprout" : i === index ? "bg-forest" : "bg-mist",
          )}
        />
      ))}
    </ol>
  );
}

type StepProps = {
  draft: OnboardingDraft;
  update: (mutate: (d: OnboardingDraft) => void) => void;
};

function ConsentStep({ draft, update }: StepProps) {
  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm text-slate">
        <p className="text-ink">
          AgriSense tells you the best window to apply a biological product on your field, why
          that window, and what it is worth — then keeps a record of your season.
        </p>
        <p className="mt-2">
          To do that it needs your field&apos;s location and a few details about your crop. Your
          location is kept at field level, not household level.
        </p>
      </Card>

      {/* Service consent is separate from the two optional opt-ins, as the
          spec requires — bundling them would make the optional ones coerced. */}
      <ConsentRow
        checked={draft.consents.service}
        onChange={(v) => update((d) => void (d.consents.service = v))}
        label="I agree to AgriSense using my field details to give me advice"
        detail="Required. Without this there is nothing to base a recommendation on."
        required
      />
      <ConsentRow
        checked={draft.consents.modelLearning}
        onChange={(v) => update((d) => void (d.consents.modelLearning = v))}
        label="Use my season records to improve advice for other farmers"
        detail="Optional. Your records are used in aggregate. You can change this later."
      />
      <ConsentRow
        checked={draft.consents.notifications}
        onChange={(v) => update((d) => void (d.consents.notifications = v))}
        label="Send me alerts when conditions change"
        detail="Optional. You choose the channel and quiet hours later."
      />
    </div>
  );
}

function ConsentRow({
  checked,
  onChange,
  label,
  detail,
  required,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  detail: string;
  required?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-card border border-mist bg-card p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[var(--forest)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">
          {label}
          {required ? <span className="ml-1 text-clay">*</span> : null}
        </span>
        <span className="mt-0.5 block text-xs text-slate">{detail}</span>
      </span>
    </label>
  );
}

function LocationStep({ draft, update }: StepProps) {
  const [state, setState] = useState<"idle" | "asking" | "denied" | "unsupported">("idle");
  const [manual, setManual] = useState("");

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setState("unsupported");
      return;
    }
    setState("asking");
    // Only ever called from this tap — never on page load, which would show a
    // browser permission prompt before the farmer knows what it is for.
    navigator.geolocation.getCurrentPosition(
      (position) => {
        update((d) => {
          d.location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            source: "gps",
            precisionM: Number.isFinite(position.coords.accuracy)
              ? Math.round(position.coords.accuracy)
              : null,
            label: null,
          };
        });
        setState("idle");
      },
      () => setState("denied"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  const hasLocation = draft.location.latitude !== null;

  return (
    <div className="space-y-4">
      <Button size="lg" className="w-full" onClick={requestLocation} busy={state === "asking"}>
        <MapPin aria-hidden className="size-4" />
        Use my location
      </Button>

      {state === "denied" || state === "unsupported" ? (
        <Callout tone="caution" title="We could not read your location">
          {state === "unsupported"
            ? "This device does not offer location sharing."
            : "Location permission was declined. You can enter your village or pincode instead."}
        </Callout>
      ) : null}

      <PlaceSearch draft={draft} update={update} query={manual} setQuery={setManual} />

      {hasLocation ? (
        <Callout tone="success" title="Location captured">
          <p className="tabular">
            {draft.location.latitude?.toFixed(5)}, {draft.location.longitude?.toFixed(5)}
            {draft.location.precisionM !== null
              ? ` · accurate to about ${draft.location.precisionM} m`
              : ""}
          </p>
          <p className="mt-1 text-xs">
            Source: {draft.location.source === "gps" ? "your device's GPS" : draft.location.source}
          </p>
        </Callout>
      ) : null}
    </div>
  );
}

/**
 * Village and pincode search, backed by `GET /catalog/locations`.
 *
 * This is the path for a farmer who declines GPS, which the spec requires to be
 * a real alternative rather than a dead end. The result's centroid IS saved as
 * the field's coordinates — the contract requires a centroid — but with
 * `source: "village"` and the provider's own coarse `precision_m`, so nothing
 * downstream can mistake a settlement centroid for the field's actual position.
 */
function PlaceSearch({
  draft,
  update,
  query,
  setQuery,
}: StepProps & { query: string; setQuery: (v: string) => void }) {
  const { t } = useLanguage();
  const [results, setResults] = useState<LocationResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (q === "") return;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const { data } = await catalogApi.locations({ q, limit: 8 });
      setResults(data.items);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.isDependencyUnavailable
            ? "Place search is unavailable right now. Try “Use my location” instead."
            : cause.message
          : t("errorUnreachable"),
      );
    } finally {
      setSearching(false);
    }
  }

  const chosen = draft.location.source === "village" ? draft.location.label : null;

  return (
    <Card className="p-4">
      <TextField
        label="Village or pincode"
        hint="Use this if you would rather not share exact location."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void search();
          }
        }}
        inputMode="text"
      />
      <Button
        variant="secondary"
        className="mt-3 w-full"
        disabled={query.trim() === ""}
        busy={searching}
        busyLabel="Searching"
        onClick={() => void search()}
      >
        <Search aria-hidden className="size-4" />
        Search
      </Button>

      {error ? (
        <Callout tone="caution" className="mt-3 text-xs">
          {error}
        </Callout>
      ) : null}

      {results !== null && results.length === 0 ? (
        <Callout tone="info" className="mt-3 text-xs">
          No place matched “{query.trim()}”. Try the district name, or a nearby larger village.
        </Callout>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-mist pt-3">
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() =>
                  update((d) => {
                    d.location = {
                      latitude: place.centroid.latitude,
                      longitude: place.centroid.longitude,
                      // Never "gps": this is a settlement centroid.
                      source: "village",
                      precisionM: place.centroid.precision_m ?? 5000,
                      label: [place.name, place.district, place.state]
                        .filter(Boolean)
                        .join(", "),
                    };
                  })
                }
                className="flex min-h-[52px] w-full items-start gap-2 rounded-control border border-mist bg-card px-3 py-2 text-left"
              >
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-forest" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{place.name}</span>
                  <span className="block truncate text-xs text-slate">
                    {[place.district, place.state].filter(Boolean).join(", ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {chosen ? (
        <Callout tone="success" className="mt-3 text-xs" title="Approximate location set">
          <p>
            <span className="font-semibold text-ink">{chosen}</span>
          </p>
          <p className="mt-1">
            This is the centre of that place, not your field&apos;s exact position — advice will be
            less specific than with GPS. You can replace it later.
          </p>
        </Callout>
      ) : null}
    </Card>
  );
}

function LandStep({
  draft,
  update,
  area,
}: StepProps & { area: ReturnType<typeof parseArea> | null }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);

  const areaError =
    touched && area && !area.ok
      ? area.reason === "empty"
        ? "Enter how much land this field is."
        : area.reason === "not_a_number"
          ? "Enter only a number, for example 2.5"
          : area.reason === "not_positive"
            ? "The area must be greater than zero."
            : "That area looks too large. Check the number and the unit."
      : undefined;

  return (
    <div className="space-y-4">
      <TextField
        ref={nameRef}
        label="Field name"
        hint="Anything you will recognise, like “North field”."
        value={draft.land.name}
        onChange={(e) => update((d) => void (d.land.name = e.target.value))}
      />

      <div>
        <TextField
          label="Area"
          inputMode="decimal"
          value={draft.land.enteredArea}
          onChange={(e) => update((d) => void (d.land.enteredArea = e.target.value))}
          onBlur={() => setTouched(true)}
          error={areaError}
        />
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Area unit">
          {AREA_UNITS.map((unit) => (
            <button
              key={unit}
              type="button"
              aria-pressed={draft.land.unit === unit}
              onClick={() => update((d) => void (d.land.unit = unit as AreaUnit))}
              className={cn(
                "min-h-[44px] rounded-control border px-4 text-sm font-semibold",
                draft.land.unit === unit
                  ? "border-forest bg-forest text-white"
                  : "border-mist bg-card text-ink",
              )}
            >
              {unit === "ha" ? "hectare" : unit === "sqm" ? "sq metre" : unit}
            </button>
          ))}
        </div>

        {/* The echo-back. A unit slip is invisible without it. */}
        {area?.ok ? (
          <p className="mt-2 text-sm text-slate">
            That is{" "}
            <span className="font-semibold text-ink">
              {formatArea(roundHectares(area.areaHa), "ha")}
            </span>
            {draft.land.unit !== "ha" ? ` (${area.enteredArea} ${draft.land.unit})` : ""}.
          </p>
        ) : null}

        {AMBIGUOUS_UNITS.has(draft.land.unit) ? (
          <Callout tone="caution" className="mt-2 text-xs">
            A kanal is not the same size everywhere. This uses the Punjab kanal of 5,445 sq ft.
            Check the hectare figure above matches your field.
          </Callout>
        ) : null}
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">How do you water it?</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["rainfed", "flood", "furrow", "sprinkler", "drip"].map((method) => (
            <button
              key={method}
              type="button"
              aria-pressed={draft.land.irrigationMethod === method}
              onClick={() =>
                update((d) => {
                  d.land.irrigationMethod = d.land.irrigationMethod === method ? null : method;
                })
              }
              className={cn(
                "min-h-[44px] rounded-control border px-4 text-sm font-semibold capitalize",
                draft.land.irrigationMethod === method
                  ? "border-forest bg-forest text-white"
                  : "border-mist bg-card text-ink",
              )}
            >
              {method}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate">Optional. You can add this later.</p>
      </fieldset>
    </div>
  );
}

function CropStep({
  draft,
  update,
  areaHa,
}: StepProps & { areaHa: number | null }) {
  const { crops, cropFor, isLoading: cropsLoading } = useCrops();
  const fieldId = draft.fieldId;

  // "Help me choose" compares the reviewed catalogue; naming a crop compares
  // that one against the same field so the figures are on the same footing.
  const candidates = useMemo(() => {
    if (draft.crop.mode === "known") return draft.crop.cropId ? [draft.crop.cropId] : [];
    if (draft.crop.mode === "help_me_choose") {
      return crops.slice(0, MAX_CANDIDATES).map((c) => c.id);
    }
    return [];
  }, [draft.crop.mode, draft.crop.cropId, crops]);

  const { comparison, loading, error } = useAutoComparison(fieldId, candidates);

  // Server order, not a local re-sort: the engine already ranked these.
  const ranked = useMemo(() => comparison?.candidates ?? [], [comparison]);
  const water = useMemo(() => waterScores(ranked), [ranked]);

  const [choosing, setChoosing] = useState<string | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);

  /**
   * Starts the season straight from the comparison.
   *
   * The whole point of showing these figures here is that the farmer decides
   * while looking at them, so the choice is committed on this screen rather
   * than deferred to a picker on another one.
   */
  async function choose(cropId: string) {
    if (!fieldId || !areaHa) return;
    setChoosing(cropId);
    setChooseError(null);
    try {
      const { data } = await fieldsApi.createSeason(
        fieldId,
        {
          crop_id: cropId,
          allocated_area_ha: roundHectares(areaHa),
          status: "active",
        },
        newIdempotencyKey(),
      );
      update((d) => {
        d.crop.mode = "known";
        d.crop.cropId = cropId;
        d.crop.cropName = cropFor(cropId)?.name ?? cropId;
        d.crop.seasonId = data.id;
      });
    } catch (cause) {
      setChooseError(
        cause instanceof ApiError ? cause.message : "That crop could not be added.",
      );
    } finally {
      setChoosing(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate">
        Pick a crop and see what it would do on this field, or let AgriSense suggest some. You
        can also skip this and decide later.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <ModeCard
          selected={draft.crop.mode === "known"}
          onClick={() => update((d) => void (d.crop.mode = "known"))}
          title="I already have a crop"
          detail="See how it suits this field before you commit."
        />
        <ModeCard
          selected={draft.crop.mode === "help_me_choose"}
          onClick={() => update((d) => void (d.crop.mode = "help_me_choose"))}
          title="Suggest crops"
          detail="Compare fit, water and expected return."
        />
      </div>

      {draft.crop.mode === "known" ? (
        <CropPicker
          crops={crops}
          loading={cropsLoading}
          selected={draft.crop.cropId}
          onSelect={(id) =>
            update((d) => {
              d.crop.cropId = id;
              d.crop.cropName = crops.find((c) => c.id === id)?.name ?? id;
            })
          }
        />
      ) : null}

      {/* Without a saved field there is nothing to score against, and saying so
          is better than showing an empty comparison that looks like a failure. */}
      {draft.crop.mode !== "undecided" && !fieldId ? (
        <Callout tone="caution" title="Your field is not saved yet">
          Go back one step and save your land details. A crop is scored against a particular
          field, so there is nothing to compare until then.
        </Callout>
      ) : null}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      ) : null}

      {error ? (
        <Callout tone="blocked" title="The comparison could not be loaded">
          {error.message}
        </Callout>
      ) : null}

      {chooseError ? (
        <Callout tone="blocked" title="That crop could not be added">
          {chooseError}
        </Callout>
      ) : null}

      {!loading && ranked.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink">
            {draft.crop.mode === "known"
              ? "How this crop suits your field"
              : `${ranked.length} crop${ranked.length === 1 ? "" : "s"} compared for your field`}
          </p>
          {ranked.map((plan, index) => (
            <CropCard
              key={plan.crop_id}
              plan={plan}
              crop={cropFor(plan.crop_id)}
              areaHa={areaHa ?? 0}
              rank={draft.crop.mode === "known" ? undefined : index + 1}
              waterScore={water.get(plan.crop_id) ?? null}
              selected={draft.crop.cropId === plan.crop_id}
              onChoose={() => void choose(plan.crop_id)}
              choosing={choosing === plan.crop_id}
            />
          ))}
        </div>
      ) : null}

      {/*
        The engine declining to score a crop is a real answer, not an empty
        state, and the farmer is told which crops and why. They are not blocked
        by it: a season can still be recorded, and the figures fill in once the
        reviewed data for their district is published.
      */}
      {!loading && !error && ranked.length === 0 && comparison ? (
        <NoCandidates
          comparison={comparison}
          fieldName={draft.land.name.trim() || "this field"}
          nameFor={(id) => cropFor(id)?.name ?? id}
          footer={
            draft.crop.cropId && !draft.crop.seasonId ? (
              <div className="mt-3">
                <Button
                  onClick={() => void choose(draft.crop.cropId!)}
                  busy={choosing !== null}
                  busyLabel="Adding"
                >
                  Start a season with {cropFor(draft.crop.cropId)?.name ?? draft.crop.cropId}
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-sm">
                Choose &ldquo;I already have a crop&rdquo; above to record your season anyway.
              </p>
            )
          }
        />
      ) : null}

      {/* Only once the season exists. Selecting a crop in the picker is not the
          same as committing to it, and saying so before the request has even
          been made is simply untrue. */}
      {draft.crop.seasonId && draft.crop.cropName ? (
        <Callout tone="success" title={`${draft.crop.cropName} is set for this field`}>
          You can change it, or add a second crop, from the field&rsquo;s own screen later.
        </Callout>
      ) : null}
    </div>
  );
}

/** The reviewed catalogue, not a free-text box: a crop id has to be real. */
function CropPicker({
  crops,
  loading,
  selected,
  onSelect,
}: {
  crops: Crop[];
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) return <Skeleton className="h-12 w-full rounded-control" />;
  if (crops.length === 0) {
    return (
      <Callout tone="caution" title="The crop list could not be loaded">
        You can set the crop later from the field&rsquo;s own screen.
      </Callout>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Crop">
      {crops.map((crop) => (
        <button
          key={crop.id}
          type="button"
          aria-pressed={selected === crop.id}
          onClick={() => onSelect(crop.id)}
          className={cn(
            "min-h-[44px] rounded-control border px-3 text-sm font-semibold",
            selected === crop.id
              ? "border-forest bg-forest text-white"
              : "border-mist bg-card text-ink",
          )}
        >
          {crop.name}
        </button>
      ))}
    </div>
  );
}

function ModeCard({
  selected,
  onClick,
  title,
  detail,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-card border p-4 text-left",
        selected ? "border-forest bg-[color-mix(in_srgb,var(--sprout)_10%,var(--card))]" : "border-mist bg-card",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
        {selected ? <Check aria-hidden className="size-4 text-forest" /> : null}
        {title}
      </span>
      <span className="mt-1 block text-xs text-slate">{detail}</span>
    </button>
  );
}

function SoilStep({ draft, update }: StepProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate">
        A soil health card makes the advice more specific. It is not required.
      </p>
      {(
        [
          ["have_card", "I have a soil health card", "Upload it and check the values we read."],
          ["no_card", "I do not have one", "We will use estimated soil data, clearly labelled."],
          ["later", "I will add it later", "Skip for now."],
        ] as const
      ).map(([intent, title, detail]) => (
        <ModeCard
          key={intent}
          selected={draft.soil.intent === intent}
          onClick={() => update((d) => void (d.soil.intent = intent))}
          title={title}
          detail={detail}
        />
      ))}

      {draft.soil.intent === "have_card" ? (
        <Callout tone="caution" title="Upload is not built yet">
          Reading a soil card needs the media upload and extraction path, which is not wired up on
          this screen yet. Choose &ldquo;I will add it later&rdquo; to continue — the field saves
          without it.
        </Callout>
      ) : null}

      {draft.soil.intent === "no_card" ? (
        <Callout tone="info" className="text-xs">
          Any soil value we estimate will be shown as an estimate, never as a measurement from
          your field.
        </Callout>
      ) : null}
    </div>
  );
}

function ReviewStep({
  draft,
  area,
}: {
  draft: OnboardingDraft;
  area: ReturnType<typeof parseArea> | null;
}) {
  const rows: Array<[string, string]> = [
    ["Field name", draft.land.name.trim() || "—"],
    [
      "Area",
      area?.ok
        ? `${formatArea(roundHectares(area.areaHa), "ha")} (entered ${area.enteredArea} ${area.unit})`
        : "—",
    ],
    [
      "Location",
      draft.location.latitude !== null
        ? `${draft.location.latitude.toFixed(5)}, ${draft.location.longitude?.toFixed(5)} · ${
            draft.location.source === "gps" ? "GPS" : "approximate"
          }`
        : draft.location.label
          ? `${draft.location.label} · approximate, needs coordinates`
          : "—",
    ],
    ["Watering", draft.land.irrigationMethod ?? "Not set"],
    [
      "Crop",
      draft.crop.cropName ?? (draft.crop.mode === "undecided" ? "Not set" : "To be added"),
    ],
    ["Soil test", draft.soil.intent === "have_card" ? "To be uploaded" : draft.soil.intent === "no_card" ? "None" : "Later"],
  ];

  return (
    <div className="space-y-4">
      <Card className="divide-y divide-mist">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 p-3">
            <span className="text-sm text-slate">{label}</span>
            <span className="text-right text-sm font-semibold text-ink">{value}</span>
          </div>
        ))}
      </Card>

      <Callout tone="info" className="text-xs">
        Saving creates this field once. If the connection drops and you try again, it will not
        create a duplicate.
      </Callout>
    </div>
  );
}
