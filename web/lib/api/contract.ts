/**
 * Named aliases over the generated contract types.
 *
 * `web/lib/generated/api.ts` is Phase 3-owned and regenerated from
 * `contracts/`. Feature code imports friendly names from here rather than
 * writing `Schema<"Field">` inline, so a regeneration that renames or reshapes
 * a schema breaks in one file instead of across every screen.
 *
 * Nothing in this file may add, widen or default a field. If a shape is wrong
 * or missing, that is an interface request to Phase 3, not a local patch —
 * a hand-written type that drifts from the contract is exactly the failure this
 * file replaces.
 */
import type { Schema, paths } from "@/lib/generated/api";

export type { Schema, paths };

/* ── envelope and errors ─────────────────────────────────────────────────── */

export type Meta = Schema<"Meta">;
export type Provenance = Schema<"Provenance">;
export type ErrorDetail = Schema<"ErrorDetail">;
export type ErrorResponse = Schema<"ErrorResponse">;

/** `data_mode` drives the visible honesty badge on every screen. */
export type DataMode = Meta["data_mode"];

/* ── account ─────────────────────────────────────────────────────────────── */

export type Farmer = Schema<"Farmer">;
export type ProfilePatch = Schema<"ProfilePatch">;
export type Consent = Schema<"Consent">;
export type LanguageCode = NonNullable<Farmer["preferred_language"]>;

/* ── field and location ──────────────────────────────────────────────────── */

export type Field = Schema<"Field">;
export type FieldCreate = Schema<"FieldCreate">;
export type FieldPatch = Schema<"FieldPatch">;
export type Location = Schema<"Location">;
export type Polygon = Schema<"Polygon">;

/** Four units, not two: `sqm` and `kanal` are in the contract. */
export type AreaUnit = Field["entered_area_unit"];
export type LocationSource = Location["source"];

/* ── season ──────────────────────────────────────────────────────────────── */

export type Season = Schema<"Season">;
export type SeasonCreate = Schema<"SeasonCreate">;
export type SeasonPatch = Schema<"SeasonPatch">;
export type SeasonStatus = Season["status"];
export type DateConfidence = Season["date_confidence"];
export type StageSource = Season["stage_source"];

/* ── soil ────────────────────────────────────────────────────────────────── */

export type SoilObservation = Schema<"SoilObservation">;

/**
 * A moisture reading the farmer took themselves.
 *
 * The only soil input that can carry today's date, and therefore the only one
 * the water balance can start from.
 */
export type SoilReadingCreate = Schema<"SoilReadingCreate">;
export type MoistureBasis = SoilReadingCreate["moisture_basis"];
export type Measurement = Schema<"Measurement">;

/* ── recommendation and evaluation ───────────────────────────────────────── */

export type Recommendation = Schema<"Recommendation">;
export type Reason = Schema<"Reason">;
export type Estimate = Schema<"Estimate">;
export type WaterEstimate = Schema<"WaterEstimate">;
export type Economics = Schema<"Economics">;
export type ForecastBundle = Schema<"ForecastBundle">;

/** What one evaluation produced: advice plus the water and money that go with it. */
export type EvaluationBundle = Schema<"EvaluationBundle">;

/* ── closure and prediction review ───────────────────────────────────────── */

export type SeasonCloseRequest = Schema<"SeasonCloseRequest">;
export type SeasonClosure = Schema<"SeasonClosure">;
export type SeasonEvaluation = Schema<"SeasonEvaluation">;

/**
 * A scoring metric with an explicit denominator policy.
 *
 * `value` is nullable and `denominator_policy` says what was counted, because a
 * percentage error over an unstated denominator is not comparable to anything.
 */
export type ErrorMetric = Schema<"ErrorMetric">;
export type ForecastHour = Schema<"ForecastHour">;
export type Interval = Schema<"Interval">;

/**
 * A stress curve carries one point per (date, stress type), so a single day can
 * appear more than once. Screens must group by `stress_type` rather than
 * assuming one series, or heat and moisture stress overwrite each other.
 */
export type StressPoint = Schema<"StressPoint">;
export type StressOnset = Schema<"StressOnset">;
export type SafetyCheck = Schema<"SafetyCheck">;
export type ProductFit = Schema<"ProductFit">;
export type RecommendationStatus = Recommendation["status"];
export type SafetyStatus = SafetyCheck["status"];

/* ── planning ────────────────────────────────────────────────────────────── */

export type PlanningRequest = Schema<"PlanningRequest">;
export type CropComparison = Schema<"CropComparison">;
export type CropPlan = Schema<"CropPlan">;

/* ── journal, tasks, notifications ───────────────────────────────────────── */

export type JournalEntry = Schema<"JournalEntry">;
export type JournalCreate = Schema<"JournalCreate">;
export type Task = Schema<"Task">;
export type Notification = Schema<"Notification">;
export type Reminder = Schema<"Reminder">;

/* ── conversations ───────────────────────────────────────────────────────── */

export type Conversation = Schema<"Conversation">;
export type ConversationCreate = Schema<"ConversationCreate">;
export type Message = Schema<"Message">;
export type MessageCreate = Schema<"MessageCreate">;
export type MutationReceipt = Schema<"MutationReceipt">;
export type ProposedMutation = Schema<"ProposedMutation">;

/* ── catalog and jobs ────────────────────────────────────────────────────── */

export type Crop = Schema<"Crop">;
export type Product = Schema<"Product">;
export type LocationResult = Schema<"LocationResult">;
export type Job = Schema<"Job">;

/* ── pagination ──────────────────────────────────────────────────────────── */

/**
 * The generated schemas name each page concretely (`Page[Field]`), so this
 * mirrors the shape structurally for code that is generic over item type.
 * Route helpers still return the concrete generated page type.
 */
export type Page<T> = { items: T[]; next_cursor?: string | null };
