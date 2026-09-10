"use client";

/**
 * Local persistence for an in-progress onboarding.
 *
 * Two requirements shape this:
 *
 *  - "A refresh restores unfinished work." A farmer on a patchy connection
 *    should not lose four screens of typing to a reload.
 *  - "Submitting twice creates one field." The idempotency key is generated
 *    once, when the draft is created, and stored *with* the draft. A retry
 *    after a timeout — or a second tap on Save — reuses the same key, so the
 *    server collapses them into one field. Generating the key at submit time
 *    would defeat this entirely.
 *
 * The draft holds farm location, which is personal data. It lives in
 * `localStorage` under the `agrisense.draft.` prefix that the auth provider
 * clears on sign-out and on any change of identity, and it is never sent
 * anywhere except as the eventual create request.
 */
import type { AreaUnit, LocationSource } from "@/lib/api/contract";

const KEY_PREFIX = "agrisense.draft.onboarding";
// Bumped when the shape changes: loadDraft discards rather than migrates an
// older draft by design, so resuming never half-understands a stale structure.
// v2 added `fieldId`, v3 added `crop.seasonId`, v4 added the land budgets.
const DRAFT_VERSION = 4;

export type CropChoiceMode = "known" | "help_me_choose" | "undecided";

export type OnboardingDraft = {
  version: number;
  /** Generated once so retries collapse into a single created field. */
  idempotencyKey: string;
  startedAt: string;
  step: number;

  /**
   * The saved field, once it exists.
   *
   * The field is created when the farmer leaves the land step rather than at
   * the end, because comparing crops needs a real `field_id` — the engine
   * scores a crop *against a field*, and there is nothing to score against
   * until the field is saved. It also means a farmer who abandons onboarding
   * halfway keeps the land they entered instead of losing it.
   */
  fieldId: string | null;

  consents: { service: boolean; modelLearning: boolean; notifications: boolean };

  location: {
    latitude: number | null;
    longitude: number | null;
    /** `gps` is precise; `village`/`manual` are a centroid and must be labelled
     *  as approximate rather than presented as the field's real position. */
    source: LocationSource | null;
    precisionM: number | null;
    label: string | null;
  };

  land: {
    name: string;
    /** Kept exactly as typed, so the echo-back shows the farmer their own number. */
    enteredArea: string;
    unit: AreaUnit;
    irrigationMethod: string | null;
    /**
     * How much water and cash are available for one season.
     *
     * Both are needed to compare crops at all: the engine refuses a candidate
     * when either is unstated rather than assuming the farmer can afford it.
     * Kept as typed strings for the same reason as the area — the echo-back has
     * to show the farmer their own number.
     */
    availableWater: string;
    waterBudget: string;
  };

  crop: {
    mode: CropChoiceMode;
    cropId: string | null;
    /**
     * Set only once the season actually exists on the server.
     *
     * `cropId` alone means "highlighted in the picker", which is not a
     * commitment — treating the two as the same told farmers their crop was
     * saved the instant they tapped it, before any request had been made.
     */
    seasonId: string | null;
    cropName: string | null;
    variety: string | null;
    planted: boolean | null;
    sowingDate: string | null;
    dateApproximate: boolean;
  };

  soil: { intent: "have_card" | "no_card" | "later" | null };
};

export function newDraft(idempotencyKey: string): OnboardingDraft {
  return {
    version: DRAFT_VERSION,
    idempotencyKey,
    startedAt: new Date().toISOString(),
    step: 0,
    fieldId: null,
    consents: { service: false, modelLearning: false, notifications: false },
    location: { latitude: null, longitude: null, source: null, precisionM: null, label: null },
    land: {
      name: "",
      enteredArea: "",
      unit: "acre",
      irrigationMethod: null,
      availableWater: "",
      waterBudget: "",
    },
    crop: {
      mode: "undecided",
      cropId: null,
      seasonId: null,
      cropName: null,
      variety: null,
      planted: null,
      sowingDate: null,
      dateApproximate: false,
    },
    soil: { intent: null },
  };
}

/** Scoped per account so one farmer's draft cannot surface under another. */
function storageKey(uid: string): string {
  return `${KEY_PREFIX}.${uid}`;
}

export function loadDraft(uid: string): OnboardingDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isDraft(parsed)) return null;
    // A draft written by an older shape is discarded rather than migrated:
    // resuming a half-understood structure risks submitting wrong values.
    if (parsed.version !== DRAFT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(uid: string, draft: OnboardingDraft): void {
  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(draft));
  } catch {
    // Quota or blocked storage. Onboarding still works; it just will not
    // survive a reload, which is a degradation rather than a failure.
  }
}

export function clearDraft(uid: string): void {
  try {
    window.localStorage.removeItem(storageKey(uid));
  } catch {
    /* nothing to clear */
  }
}

function isDraft(value: unknown): value is OnboardingDraft {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<OnboardingDraft>;
  return (
    typeof v.version === "number" &&
    typeof v.idempotencyKey === "string" &&
    typeof v.step === "number" &&
    typeof v.consents === "object" &&
    typeof v.location === "object" &&
    typeof v.land === "object" &&
    typeof v.crop === "object"
  );
}

/* ─────────────────────────────────────────────────────────── step validity */

export type StepId = "consent" | "location" | "land" | "crop" | "soil" | "review";

export const STEPS: readonly StepId[] = ["consent", "location", "land", "crop", "soil", "review"];

/**
 * Whether a step has what it needs to advance.
 *
 * Only the service consent, a location and a valid area are genuinely required.
 * The spec is explicit that missing *optional* information must produce a
 * visible data request later rather than blocking basic onboarding — so crop
 * and soil can both be deferred.
 */
export function canAdvance(step: StepId, draft: OnboardingDraft): boolean {
  switch (step) {
    case "consent":
      return draft.consents.service;
    case "location":
      return draft.location.latitude !== null && draft.location.longitude !== null;
    case "land":
      return draft.land.name.trim() !== "" && draft.land.enteredArea.trim() !== "";
    case "crop":
    case "soil":
      return true;
    case "review":
      return (
        draft.consents.service &&
        draft.location.latitude !== null &&
        draft.land.name.trim() !== "" &&
        draft.land.enteredArea.trim() !== ""
      );
  }
}
