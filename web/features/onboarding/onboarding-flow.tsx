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
import { Button, Callout, Card, TextField } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError } from "@/lib/api/envelope";
import { fields as fieldsApi } from "@/lib/api/routes";
import { newIdempotencyKey } from "@/lib/api/client";
import type { AreaUnit, LocationSource } from "@/lib/api/contract";
import { AMBIGUOUS_UNITS, AREA_UNITS, parseArea, roundHectares } from "@/lib/area";
import { formatArea } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { Check, ChevronLeft, Loader2, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
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

  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Restore an interrupted onboarding, or start a fresh one. The idempotency
  // key is minted here, once, and then lives in the draft.
  useEffect(() => {
    if (!uid) return;
    const existing = loadDraft(uid);
    if (existing) {
      setDraft(existing);
      setRestored(true);
    } else {
      setDraft(newDraft(newIdempotencyKey()));
    }
  }, [uid]);

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

  const goBack = useCallback(() => {
    update((d) => {
      d.step = Math.max(d.step - 1, 0);
    });
  }, [update]);

  const area = useMemo(() => {
    if (!draft) return null;
    return parseArea(draft.land.enteredArea, draft.land.unit);
  }, [draft]);

  async function save() {
    if (!draft || !uid || !area?.ok) return;
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
      clearDraft(uid);
      router.replace(`/?field=${encodeURIComponent(data.id)}`);
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
    } finally {
      setSaving(false);
    }
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
        {step === "crop" ? <CropStep draft={draft} update={update} /> : null}
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
            onClick={goNext}
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

      <Card className="p-4">
        <TextField
          label="Village or pincode"
          hint="Use this if you would rather not share exact location."
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          inputMode="text"
        />
        <Button
          variant="secondary"
          className="mt-3 w-full"
          disabled={manual.trim() === ""}
          onClick={() =>
            update((d) => {
              // A village or pincode resolves to a centroid, which is NOT the
              // field's position. It is stored with a different source and a
              // coarse precision so nothing downstream can mistake it for GPS.
              d.location = {
                latitude: null,
                longitude: null,
                source: "village",
                precisionM: 5000,
                label: manual.trim(),
              };
            })
          }
        >
          Use this place
        </Button>
        {draft.location.source === "village" && draft.location.label ? (
          <Callout tone="caution" className="mt-3 text-xs" title="Not enough to save yet">
            <p>
              <span className="font-semibold text-ink">{draft.location.label}</span> is recorded as
              an approximate area, not your field&apos;s exact position. Turning it into
              coordinates needs the location catalogue, which is not being served yet.
            </p>
            <p className="mt-2">
              To finish now, use <span className="font-semibold text-ink">Use my location</span>
              {" "}above. Otherwise come back when place search is working — what you have entered
              is saved on this device.
            </p>
          </Callout>
        ) : null}
      </Card>

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

function CropStep({ draft, update }: StepProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate">
        You can set the crop now or after saving the field.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <ModeCard
          selected={draft.crop.mode === "known"}
          onClick={() => update((d) => void (d.crop.mode = "known"))}
          title="I already have a crop"
          detail="Tell us what is planted or what you plan to plant."
        />
        <ModeCard
          selected={draft.crop.mode === "help_me_choose"}
          onClick={() => update((d) => void (d.crop.mode = "help_me_choose"))}
          title="Help me choose"
          detail="Compare crops that suit this field."
        />
      </div>

      {/*
        Both branches need the crop catalogue, and /catalog/crops currently
        answers 503 DEPENDENCY_UNAVAILABLE because nothing builds a
        ReferenceBundle on the science side. Saying so plainly is the correct
        behaviour: an empty crop list would read as "no crops exist", and a
        hardcoded list would be an invented catalogue.
      */}
      {draft.crop.mode !== "undecided" ? (
        <Callout tone="caution" title="Crop details are not available yet">
          <p>
            The crop catalogue is not being served right now, so AgriSense cannot offer a crop
            list or compare crops for this field.
          </p>
          <p className="mt-2">
            Save the field and add the crop when this is working — nothing you have entered is
            lost, and the field is what the rest of the app needs first.
          </p>
        </Callout>
      ) : null}
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
