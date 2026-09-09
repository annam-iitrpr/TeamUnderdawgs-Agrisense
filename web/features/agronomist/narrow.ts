/**
 * Runtime narrowing for the agronomist endpoints.
 *
 * `lib/api/routes.ts` types these responses as `Result<unknown>` because the
 * concrete shapes were never pinned there. Rather than assert a shape with
 * `as`, which would turn a contract change into a runtime crash inside a
 * render, every field is checked here and anything unrecognised becomes `null`.
 *
 * The rule throughout: a value that is absent, non-numeric or explicitly null
 * stays `null`. It never becomes `0`. On this screen a fabricated zero would
 * read as "no stress" or "no fields", which are claims, not gaps.
 */
import type { Schema } from "@/lib/api/contract";

export type AgronomistSummary = Schema<"AgronomistSummary">;
export type StressMapPoint = Schema<"StressMapPoint">;
export type EvidenceRecord = Schema<"EvidenceRecord">;
export type ModelVersion = Schema<"ModelVersion">;
export type ErrorMetric = Schema<"ErrorMetric">;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number, or null. Rejects NaN, Infinity and numeric strings. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Counts keyed by recommendation status. Non-numeric entries are dropped
 *  rather than coerced, so a malformed count cannot become a displayed 0. */
function countMap(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = num(raw);
    if (n !== null) out[key] = n;
  }
  return out;
}

export type NarrowedSummary = {
  assignedFarmerCount: number | null;
  fieldCount: number | null;
  activeSeasonCount: number | null;
  recommendationStatusCounts: Record<string, number>;
};

export function narrowSummary(data: unknown): NarrowedSummary | null {
  if (!isObject(data)) return null;
  return {
    assignedFarmerCount: num(data.assigned_farmer_count),
    fieldCount: num(data.field_count),
    activeSeasonCount: num(data.active_season_count),
    recommendationStatusCounts: countMap(data.recommendation_status_counts),
  };
}

export type NarrowedStressPoint = {
  fieldId: string;
  latitude: number | null;
  longitude: number | null;
  /** 0–9 stress, or null when the engine could not determine it. */
  stress: number | null;
  missingReason: string | null;
  locationSource: string | null;
  precisionM: number | null;
};

export function narrowStressPoints(data: unknown): NarrowedStressPoint[] {
  const items = isObject(data) && Array.isArray(data.items) ? data.items : [];
  const out: NarrowedStressPoint[] = [];
  for (const raw of items) {
    if (!isObject(raw)) continue;
    const fieldId = str(raw.field_id);
    if (!fieldId) continue; // Without an id the row cannot be attributed.
    const centroid = isObject(raw.centroid) ? raw.centroid : null;
    out.push({
      fieldId,
      latitude: centroid ? num(centroid.latitude) : null,
      longitude: centroid ? num(centroid.longitude) : null,
      stress: num(raw.stress),
      missingReason: str(raw.missing_reason),
      locationSource: centroid ? str(centroid.source) : null,
      precisionM: centroid ? num(centroid.precision_m) : null,
    });
  }
  return out;
}

export type NarrowedEvidence = {
  id: string;
  kind: string | null;
  title: string | null;
  source: string | null;
  sampleCount: number | null;
  limitations: string[];
};

export function narrowEvidence(data: unknown): NarrowedEvidence[] {
  const items = isObject(data) && Array.isArray(data.items) ? data.items : [];
  const out: NarrowedEvidence[] = [];
  for (const raw of items) {
    if (!isObject(raw)) continue;
    const id = str(raw.id);
    if (!id) continue;
    out.push({
      id,
      kind: str(raw.kind),
      title: str(raw.title),
      source: str(raw.source),
      sampleCount: num(raw.sample_count),
      limitations: strArray(raw.limitations),
    });
  }
  return out;
}

export type NarrowedMetric = {
  name: string | null;
  value: number | null;
  unit: string | null;
  /** How the metric's denominator is defined. Shown verbatim beside the value:
   *  a metric without its denominator is not interpretable. */
  denominatorPolicy: string | null;
  missingReason: string | null;
};

export type ModelStatus = "candidate" | "shadow" | "approved" | "retired" | "unknown";

export type NarrowedModel = {
  id: string;
  target: string | null;
  status: ModelStatus;
  artifactHash: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  evidenceIds: string[];
  metrics: NarrowedMetric[];
};

function modelStatus(value: unknown): ModelStatus {
  return value === "candidate" || value === "shadow" || value === "approved" || value === "retired"
    ? value
    : "unknown";
}

function narrowMetrics(value: unknown): NarrowedMetric[] {
  if (!Array.isArray(value)) return [];
  const out: NarrowedMetric[] = [];
  for (const raw of value) {
    if (!isObject(raw)) continue;
    out.push({
      name: str(raw.name),
      value: num(raw.value),
      unit: str(raw.unit),
      denominatorPolicy: str(raw.denominator_policy),
      missingReason: str(raw.missing_reason),
    });
  }
  return out;
}

/**
 * Accepts either a page of models or a bare array, because the route is typed
 * `unknown` and the platform may return either.
 */
export function narrowModels(data: unknown): NarrowedModel[] {
  const items = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data.items)
      ? data.items
      : isObject(data) && Array.isArray(data.models)
        ? data.models
        : [];
  const out: NarrowedModel[] = [];
  for (const raw of items) {
    if (!isObject(raw)) continue;
    const id = str(raw.id);
    if (!id) continue;
    out.push({
      id,
      target: str(raw.target),
      status: modelStatus(raw.status),
      artifactHash: str(raw.artifact_hash),
      approvedAt: str(raw.approved_at),
      approvedBy: str(raw.approved_by),
      evidenceIds: strArray(raw.evidence_ids),
      metrics: narrowMetrics(raw.metrics),
    });
  }
  return out;
}

/**
 * Whether a model is actually serving validated predictions.
 *
 * Only `approved` with a recorded approver counts. `candidate` and `shadow`
 * mean the pipeline exists and is awaiting validation — a distinction the spec
 * insists on, because "implemented" and "validated" are different claims and
 * conflating them is how an unvalidated model ends up trusted.
 */
export function isValidatedServing(model: NarrowedModel): boolean {
  return model.status === "approved" && model.approvedBy !== null;
}

/**
 * Coarsen a coordinate for aggregate display.
 *
 * Two decimal places is roughly a 1 km cell. An agronomist looking at a
 * district overview has no need for a farm's surveyed position, and printing
 * five decimals in a shared view discloses it unnecessarily.
 */
export function coarseCoordinate(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}
