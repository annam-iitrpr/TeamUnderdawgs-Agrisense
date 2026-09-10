import { beforeEach, describe, expect, it } from "vitest";
import {
  canAdvance,
  clearDraft,
  loadDraft,
  newDraft,
  saveDraft,
  STEPS,
  type OnboardingDraft,
} from "@/features/onboarding/draft";

const UID_A = "uid-farmer-a";
const UID_B = "uid-farmer-b";

function complete(): OnboardingDraft {
  const draft = newDraft("idem-key-abcdef12");
  draft.consents.service = true;
  draft.location = {
    latitude: 21.14,
    longitude: 79.08,
    source: "gps",
    precisionM: 12,
    label: "Nagpur",
  };
  draft.land = {
    name: "North field",
    enteredArea: "2.5",
    unit: "acre",
    irrigationMethod: "drip",
    availableWater: "4000",
    waterBudget: "60000",
  };
  return draft;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("draft persistence", () => {
  it("round-trips a draft so a refresh restores unfinished work", () => {
    const draft = complete();
    draft.step = 3;
    saveDraft(UID_A, draft);

    const restored = loadDraft(UID_A);
    expect(restored).not.toBeNull();
    expect(restored?.step).toBe(3);
    expect(restored?.land.enteredArea).toBe("2.5");
    expect(restored?.location.latitude).toBe(21.14);
  });

  it("preserves the area exactly as typed rather than reformatting it", () => {
    // The echo-back has to show the farmer their own number, so "2,5" or
    // trailing zeros must survive the round trip untouched.
    const draft = newDraft("idem-key-abcdef12");
    draft.land.enteredArea = "2,50";
    saveDraft(UID_A, draft);
    expect(loadDraft(UID_A)?.land.enteredArea).toBe("2,50");
  });

  it("keeps one farmer's draft invisible to another account", () => {
    saveDraft(UID_A, complete());
    expect(loadDraft(UID_B)).toBeNull();
    expect(loadDraft(UID_A)).not.toBeNull();
  });

  it("clears only the addressed account's draft", () => {
    saveDraft(UID_A, complete());
    saveDraft(UID_B, complete());
    clearDraft(UID_A);
    expect(loadDraft(UID_A)).toBeNull();
    expect(loadDraft(UID_B)).not.toBeNull();
  });

  it("stores drafts under the prefix the auth provider clears on sign-out", () => {
    saveDraft(UID_A, complete());
    // Enumerated with key()/length, the same Storage API that
    // clearPerUserState() in the auth provider uses to find what to purge.
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key) keys.push(key);
    }
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith("agrisense.draft.")).toBe(true);
    }
  });

  it("discards a draft written by an older shape instead of migrating it", () => {
    // Resuming a half-understood structure risks submitting wrong values.
    const stale = { ...complete(), version: 0 };
    window.localStorage.setItem(
      "agrisense.draft.onboarding.uid-farmer-a",
      JSON.stringify(stale),
    );
    expect(loadDraft(UID_A)).toBeNull();
  });

  it("returns null for corrupt JSON rather than throwing", () => {
    window.localStorage.setItem("agrisense.draft.onboarding.uid-farmer-a", "{not json");
    expect(loadDraft(UID_A)).toBeNull();
  });

  it("returns null for JSON that is not a draft", () => {
    window.localStorage.setItem("agrisense.draft.onboarding.uid-farmer-a", '{"hello":true}');
    expect(loadDraft(UID_A)).toBeNull();
  });
});

describe("idempotency key", () => {
  it("is generated once and survives a reload, so a retry creates one field", () => {
    // This is the mechanism behind "submitting twice creates one field": the
    // key must come from the draft, not from submit time.
    const draft = complete();
    saveDraft(UID_A, draft);
    const first = loadDraft(UID_A)?.idempotencyKey;
    const second = loadDraft(UID_A)?.idempotencyKey;
    expect(first).toBe(draft.idempotencyKey);
    expect(second).toBe(first);
  });

  it("differs between two separately started onboardings", () => {
    expect(newDraft("key-one-aaaaaaa").idempotencyKey).not.toBe(
      newDraft("key-two-bbbbbbb").idempotencyKey,
    );
  });
});

describe("step gating", () => {
  it("blocks until service consent is given", () => {
    const draft = newDraft("idem-key-abcdef12");
    expect(canAdvance("consent", draft)).toBe(false);
    draft.consents.service = true;
    expect(canAdvance("consent", draft)).toBe(true);
  });

  it("does not require the optional consents", () => {
    const draft = complete();
    expect(draft.consents.modelLearning).toBe(false);
    expect(draft.consents.notifications).toBe(false);
    expect(canAdvance("consent", draft)).toBe(true);
  });

  it("requires a location", () => {
    const draft = newDraft("idem-key-abcdef12");
    expect(canAdvance("location", draft)).toBe(false);
    draft.location.latitude = 21.14;
    draft.location.longitude = 79.08;
    expect(canAdvance("location", draft)).toBe(true);
  });

  it("requires a field name and an area", () => {
    const draft = complete();
    draft.land.name = "";
    expect(canAdvance("land", draft)).toBe(false);
    draft.land.name = "North field";
    draft.land.enteredArea = "";
    expect(canAdvance("land", draft)).toBe(false);
  });

  it("lets crop and soil be deferred, because missing optional data must not block", () => {
    const draft = complete();
    expect(draft.crop.cropId).toBeNull();
    expect(draft.soil.intent).toBeNull();
    expect(canAdvance("crop", draft)).toBe(true);
    expect(canAdvance("soil", draft)).toBe(true);
    // And the whole thing can still be submitted.
    expect(canAdvance("review", draft)).toBe(true);
  });

  it("blocks review while a required field is missing", () => {
    const draft = complete();
    draft.location.latitude = null;
    expect(canAdvance("review", draft)).toBe(false);
  });

  it("declares the six steps in order", () => {
    expect(STEPS).toEqual(["consent", "location", "land", "crop", "soil", "review"]);
  });
});
