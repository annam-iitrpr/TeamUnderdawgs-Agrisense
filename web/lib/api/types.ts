/**
 * Provisional v1 domain types, written from the build spec's "core models to
 * freeze" table. Replaced by Phase 3's generated types (IR-003).
 *
 * Conventions the spec fixes and these types encode:
 *  - IDs crossing the API are opaque strings, even where legacy rows use ints.
 *  - Instants are UTC ISO-8601 strings; local calendar dates are `YYYY-MM-DD`.
 *  - A spray interval is `[start_at, end_at)` — end exclusive.
 *  - Anything the engine could not determine is `null`, never 0.
 */
import type { Unknowable } from "./envelope";

export type Id = string;
export type Instant = string; // UTC ISO-8601
export type CalendarDate = string; // YYYY-MM-DD
export type LanguageCode = "en" | "hi" | "mr" | "pa" | "te";

/* ───────────────────────────────────────────────────────────────── account */

export type Role = "farmer" | "agronomist" | "admin";

export type Me = {
  id: Id;
  tenant_id: Id;
  roles: Role[];
  email: string | null;
  email_verified: boolean;
  preferred_language: LanguageCode;
  timezone: string;
  consents: Array<{ kind: string; version: string; granted_at: Instant | null }>;
  linked_channels: Array<{ channel: "whatsapp" | "push"; linked_at: Instant }>;
  last_active_field_id: Id | null;
  last_active_season_id: Id | null;
};

/* ───────────────────────────────────────────────────────────── field, soil */

export type AreaUnit = "ha" | "acre";
export type LocationSource = "gps" | "pincode_centroid" | "map_pin" | "village_centroid";
export type IrrigationMethod =
  | "rainfed"
  | "flood"
  | "furrow"
  | "sprinkler"
  | "drip"
  | "other"
  | "unknown";

export type SoilSummary = {
  ph: Unknowable<number>;
  organic_carbon_pct: Unknowable<number>;
  organic_matter_pct: Unknowable<number>;
  texture: Unknowable<string>;
  /** Where the values came from. `gridded_estimate` must be labelled in the UI. */
  source: "lab" | "farmer" | "gridded_estimate" | "unknown";
  sampled_on: CalendarDate | null;
  confirmed: boolean;
};

export type Field = {
  id: Id;
  farmer_id: Id;
  name: string;
  area_ha: number;
  /** What the farmer actually typed, so the UI can echo it back unchanged. */
  entered_area: number;
  entered_area_unit: AreaUnit;
  centroid_latitude: number | null;
  centroid_longitude: number | null;
  polygon: GeoJsonPolygon | null;
  location_precision_m: number | null;
  location_source: LocationSource | null;
  irrigation_method: IrrigationMethod;
  available_water_litres: Unknowable<number>;
  soil: SoilSummary;
  version: number;
  archived_at: Instant | null;
};

export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][]; // lon, lat order
};

/* ────────────────────────────────────────────────────────────────── season */

export type SeasonStatus = "planned" | "active" | "closed";
export type DateConfidence = "exact" | "approximate" | "unknown";

export type Season = {
  id: Id;
  field_id: Id;
  crop_id: Id;
  crop_name: string;
  variety: string | null;
  sowing_date: CalendarDate | null;
  sowing_date_confidence: DateConfidence;
  transplanting_date: CalendarDate | null;
  stage: string | null;
  /** Farmer confirmation outranks a GDD estimate; the UI shows which it is. */
  stage_source: "farmer_confirmed" | "agronomist" | "gdd_estimate" | "unknown";
  allocated_area_ha: number;
  status: SeasonStatus;
  version: number;
};

/* ────────────────────────────────────────────────────────── recommendation */

export type RecommendationStatus =
  | "recommended"
  | "monitor"
  | "blocked"
  | "insufficient_data"
  | "out_of_scope";

/** `[start_at, end_at)` — the end instant is exclusive. */
export type SprayWindow = {
  start_at: Instant;
  end_at: Instant;
  /** 0–1 soft viability within allowed conditions; null when not computable. */
  viability: number | null;
};

export type RejectedHour = {
  start_at: Instant;
  /** Machine code plus the numeric fact behind it, so the UI can explain it. */
  reason_code: string;
  facts: Record<string, number | string | null>;
};

export type ReasonCode = {
  code: string;
  /** Numeric facts backing the reason. Phrasing is generated from these. */
  facts: Record<string, number | string | null>;
};

export type ProductFit = {
  product_id: Id | null;
  product_name: string | null;
  /** A category ("Stress Buster") is not a confirmed registered SKU. */
  is_confirmed_product: boolean;
  crop_supported: boolean | null;
  stage_supported: boolean | null;
  label_review_state: "reviewed" | "pending_review" | "unknown";
  exclusions: string[];
};

export type StressPoint = {
  date: CalendarDate;
  /** Each stress type independently nullable; null means not parameterised. */
  scores: Record<string, number | null>;
};

export type Recommendation = {
  id: Id;
  field_id: Id;
  season_id: Id;
  input_version: number;
  input_hash: string;
  generated_at: Instant;
  expires_at: Instant | null;
  rule_version: string;
  model_version: string | null;
  evidence_version: string | null;
  status: RecommendationStatus;
  /** All four independently nullable. Null renders as unknown, never a
   *  zero-length bar, which would read as "no risk". See IR-004. */
  readiness: number | null;
  need: number | null;
  timing_fit: number | null;
  viability: number | null;
  stage: string | null;
  stress_curve: StressPoint[];
  stress_onsets: Record<string, { date: CalendarDate; value: number } | null>;
  selected_window: SprayWindow | null;
  alternative_windows: SprayWindow[];
  rejected_hours: RejectedHour[];
  reason_codes: ReasonCode[];
  product_fit: ProductFit | null;
  blocked_reason: string | null;
  check_again_on: CalendarDate | null;
  incremental_value: Estimate | null;
};

/* ──────────────────────────────────────────────────────────────── estimate */

/**
 * `basis` matters and must be surfaced: `scenario` quantiles are NOT calibrated
 * confidence intervals, and a readiness index is never a success probability.
 */
export type Estimate = {
  p10: number | null;
  p50: number | null;
  p90: number | null;
  unit: string;
  basis: "scenario" | "empirically_calibrated" | "observed";
  assumptions: string[];
  evidence_ids: Id[];
  target: string;
  horizon_date: CalendarDate | null;
  input_completeness: number | null;
  calibration_sample_size: number | null;
};

/* ─────────────────────────────────────────────────────────────── crop plan */

export type CropPlan = {
  crop_id: Id;
  crop_name: string;
  variety_scope: string | null;
  sowing_window: { earliest: CalendarDate; latest: CalendarDate } | null;
  harvest_window: { earliest: CalendarDate; latest: CalendarDate } | null;
  compatibility_score: number | null;
  compatibility_components: Array<{ component: string; score: number | null; note: string | null }>;
  exclusions: string[];
  seasonal_water_mm: number | null;
  seasonal_water_litres: number | null;
  daily_water_litres: number | null;
  cost: Estimate | null;
  revenue: Estimate | null;
  profit: Estimate | null;
  roi_percent: Estimate | null;
  price_source: { source: string; as_of: CalendarDate; unit: string } | null;
  warnings: string[];
  evidence_state: "reference" | "estimated" | "insufficient";
};

export type CropComparison = {
  candidates: CropPlan[];
  /** Why fewer than five came back, when that happens. */
  exclusion_notes: string[];
  common_assumptions: {
    area_ha: number;
    budget_inr: number | null;
    as_of: CalendarDate;
  };
};

/* ───────────────────────────────────────────────────────────────── journal */

export type JournalAction =
  | "watered"
  | "fertilizer_applied"
  | "biostimulant_applied"
  | "pesticide_applied"
  | "weed_removed"
  | "observation"
  | "harvest";

export type JournalEntry = {
  id: Id;
  season_id: Id;
  action: JournalAction;
  occurred_at: Instant;
  captured_at: Instant | null;
  received_at: Instant;
  entered_by: Id;
  source: "web" | "whatsapp" | "agronomist";
  quantity: Unknowable<number>;
  quantity_unit: string | null;
  cost_inr: Unknowable<number>;
  product_id: Id | null;
  text: string | null;
  media_ids: Id[];
  linked_recommendation_id: Id | null;
  /** A draft from OCR/vision/transcription needs confirmation before it counts. */
  confirmation_state: "draft" | "needs_confirmation" | "confirmed";
  revision: number;
  observation_quality: "low" | "medium" | "high" | "unknown" | null;
};

/* ──────────────────────────────────────────── tasks, notifications, alerts */

export type TaskStatus = "pending" | "done" | "snoozed" | "cancelled" | "expired";

export type Task = {
  id: Id;
  season_id: Id;
  field_id: Id;
  title_code: string;
  due_from: Instant;
  due_to: Instant;
  priority: "low" | "medium" | "high";
  reason_codes: ReasonCode[];
  source_recommendation_id: Id | null;
  status: TaskStatus;
  /** Set when a forecast revision replaced this task. */
  superseded_by_task_id: Id | null;
  version: number;
};

export type Notification = {
  id: Id;
  field_id: Id | null;
  season_id: Id | null;
  kind: "risk_alert" | "recommendation_changed" | "task_reminder" | "informational";
  body_code: string;
  facts: Record<string, number | string | null>;
  created_at: Instant;
  read_at: Instant | null;
  /** Acknowledging an alert is not evidence that a spray happened. */
  acknowledged_at: Instant | null;
  linked_task_id: Id | null;
};

export type Reminder = {
  id: Id;
  season_id: Id;
  kind: "spray" | "watering" | "custom";
  scheduled_at: Instant;
  channel: "push" | "whatsapp" | "in_app";
  opted_in: boolean;
  quiet_hours: { start_local: string; end_local: string } | null;
  status: "scheduled" | "sent" | "cancelled";
};

/* ─────────────────────────────────────────────────────────────── closure */

export type SeasonClosure = {
  season_id: Id;
  harvest_quantity: number | null;
  harvest_unit: string | null;
  product_form: string | null;
  moisture_basis: string | null;
  harvested_area_ha: number | null;
  realized_sales_inr: number | null;
  unsold_inventory_quantity: number | null;
  realized_costs_inr: number | null;
  actual_margin_inr: number | null;
  /** Compared against immutable forecast snapshots taken at known dates. */
  forecast_comparisons: Array<{
    metric: string;
    predicted_at: Instant;
    predicted: Estimate;
    observed: number | null;
    error_definition: string;
    error_value: number | null;
    denominator_note: string | null;
  }>;
  confirmed_at: Instant | null;
};

/* ──────────────────────────────────────────────── assistant conversations */

export type ProposedMutation = {
  id: Id;
  target_type: "field" | "season" | "task" | "journal_entry";
  target_id: Id;
  expected_version: number;
  changes: Array<{ path: string; old_value: unknown; new_value: unknown }>;
  expires_at: Instant;
  originating_message_id: Id;
  state: "proposed" | "confirmed" | "cancelled" | "expired" | "conflict";
};

export type Message = {
  id: Id;
  conversation_id: Id;
  role: "farmer" | "assistant";
  text: string;
  created_at: Instant;
  /** Facts the answer was built from, each linking to the source record. */
  cited_records: Array<{ kind: string; id: Id; label: string }>;
  proposed_mutation_ids: Id[];
  media_ids: Id[];
};

export type Conversation = {
  id: Id;
  field_id: Id | null;
  season_id: Id | null;
  created_at: Instant;
};

/* ───────────────────────────────────────────────────────────────────- jobs */

export type Job = {
  id: Id;
  kind: string;
  state: "queued" | "running" | "succeeded" | "failed";
  created_at: Instant;
  finished_at: Instant | null;
  error: { code: string; message: string } | null;
  result_ref: string | null;
};

/* ───────────────────────────────────────────────────────────────── catalog */

export type CropCatalogEntry = {
  id: Id;
  name: string;
  /** Biological product advice is India-scoped to rice, wheat, cotton. A crop
   *  may be plannable while not being advisable for a product. */
  supports_biological_advice: boolean;
  seasons: string[];
};

export type ProductCatalogEntry = {
  id: Id;
  name: string;
  category: string;
  is_confirmed_product: boolean;
  supported_crop_ids: Id[];
};
