/**
 * Typed calls for the routes Phase 1 consumes.
 *
 * Paths and status codes mirror `contracts/routes.py`. Rules the contract sets,
 * enforced here so no screen can forget them:
 *   - every POST carries an `Idempotency-Key` (8–128 chars)
 *   - every PATCH carries `expected_version`, and a stale one answers 409
 *   - lists are cursor-paginated with `limit` between 1 and 100
 */
import { apiRequest, newIdempotencyKey, type Result } from "./client";
import type {
  Conversation,
  Crop,
  CropComparison,
  Economics,
  Farmer,
  Field,
  FieldCreate,
  FieldPatch,
  ForecastBundle,
  Job,
  JournalCreate,
  JournalEntry,
  LocationResult,
  Message,
  MessageCreate,
  MutationReceipt,
  ProposedMutation,
  Notification,
  Page,
  PlanningRequest,
  Product,
  Recommendation,
  Reminder,
  Season,
  SeasonCreate,
  SeasonPatch,
  SoilObservation,
  Task,
  WaterEstimate,
} from "./contract";

type Opts = { signal?: AbortSignal };
type ListOpts = Opts & { limit?: number; cursor?: string | null };

/** The contract's list bounds. A screen asking for 500 rows is a bug. */
export function pageQuery(opts: ListOpts = {}) {
  const limit = opts.limit === undefined ? undefined : Math.min(Math.max(opts.limit, 1), 100);
  return { limit, cursor: opts.cursor ?? undefined };
}

/**
 * Drift guard.
 *
 * Every path this module calls, declared as a literal and constrained to
 * `keyof paths` from the generated contract. If Phase 3 regenerates and a route
 * is renamed or removed, this fails typecheck immediately and names the path —
 * rather than the mismatch surfacing as a 404 at runtime in a demo.
 *
 * Templated segments are written with the same `{id}` placeholder the contract
 * uses; the call sites above interpolate real ids.
 */
export const CONSUMED_PATHS = [
  "/api/v1/me",
  "/api/v1/me/export",
  "/api/v1/fields",
  "/api/v1/fields/{id}",
  "/api/v1/fields/{id}/archive",
  "/api/v1/fields/{id}/seasons",
  "/api/v1/seasons/{id}",
  "/api/v1/seasons/{id}/evaluate",
  "/api/v1/seasons/{id}/recommendations/latest",
  "/api/v1/seasons/{id}/forecast",
  "/api/v1/seasons/{id}/water",
  "/api/v1/seasons/{id}/economics",
  "/api/v1/seasons/{id}/journal",
  "/api/v1/planning/compare",
  "/api/v1/catalog/crops",
  "/api/v1/catalog/products",
  "/api/v1/catalog/locations",
  "/api/v1/tasks",
  "/api/v1/tasks/{id}",
  "/api/v1/notifications",
  "/api/v1/notifications/{id}",
  "/api/v1/reminders",
  "/api/v1/conversations",
  "/api/v1/conversations/{id}/messages",
  "/api/v1/proposals/{id}/confirm",
  "/api/v1/proposals/{id}/cancel",
  "/api/v1/soil/extractions",
  "/api/v1/soil/extractions/{id}/confirm",
  "/api/v1/jobs/{id}",
  "/api/v1/media/uploads",
  "/api/v1/media/{id}/complete",
  "/api/v1/media/{id}/access",
  "/api/v1/reminders/{id}",
  "/api/v1/agronomist/summary",
  "/api/v1/agronomist/fields",
  "/api/v1/agronomist/stress-map",
  "/api/v1/agronomist/evidence",
  "/api/v1/agronomist/models",
] as const satisfies ReadonlyArray<keyof import("./contract").paths>;

/* ── profile ─────────────────────────────────────────────────────────────── */

export const me = {
  get: (o: Opts = {}): Promise<Result<Farmer>> => apiRequest("/me", { signal: o.signal }),

  patch: (
    body: { expected_version: number } & Record<string, unknown>,
    o: Opts = {},
  ): Promise<Result<Farmer>> =>
    apiRequest("/me", { method: "PATCH", body, signal: o.signal }),

  /** 202 with a job: the export is prepared asynchronously. */
  requestExport: (o: Opts = {}): Promise<Result<Job>> =>
    apiRequest("/me/export", {
      method: "POST",
      idempotencyKey: newIdempotencyKey(),
      signal: o.signal,
    }),
};

/* ── fields ──────────────────────────────────────────────────────────────── */

export const fields = {
  list: (o: ListOpts = {}): Promise<Result<Page<Field>>> =>
    apiRequest("/fields", { query: pageQuery(o), signal: o.signal }),

  get: (id: string, o: Opts = {}): Promise<Result<Field>> =>
    apiRequest(`/fields/${encodeURIComponent(id)}`, { signal: o.signal }),

  /**
   * 201. The idempotency key is generated once per attempt by the caller and
   * reused across retries, so a double tap or a flaky connection cannot create
   * two fields for one farmer action.
   */
  create: (
    body: FieldCreate,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<Field>> =>
    apiRequest("/fields", { method: "POST", body, idempotencyKey, signal: o.signal }),

  patch: (
    id: string,
    body: FieldPatch & { expected_version: number },
    o: Opts = {},
  ): Promise<Result<Field>> =>
    apiRequest(`/fields/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      signal: o.signal,
    }),

  archive: (
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<Field>> =>
    apiRequest(`/fields/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      body: { expected_version: expectedVersion },
      idempotencyKey,
      signal: o.signal,
    }),

  seasons: (fieldId: string, o: ListOpts = {}): Promise<Result<Page<Season>>> =>
    apiRequest(`/fields/${encodeURIComponent(fieldId)}/seasons`, {
      query: pageQuery(o),
      signal: o.signal,
    }),

  createSeason: (
    fieldId: string,
    body: SeasonCreate,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<Season>> =>
    apiRequest(`/fields/${encodeURIComponent(fieldId)}/seasons`, {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),
};

/* ── seasons ─────────────────────────────────────────────────────────────── */

export const seasons = {
  get: (id: string, o: Opts = {}): Promise<Result<Season>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}`, { signal: o.signal }),

  patch: (
    id: string,
    body: SeasonPatch & { expected_version: number },
    o: Opts = {},
  ): Promise<Result<Season>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      signal: o.signal,
    }),

  /**
   * May answer with an evaluation or with a job. Callers must handle both
   * rather than assuming a synchronous result — and must handle a 503
   * `DEPENDENCY_UNAVAILABLE`, which is the contract's honest answer when the
   * science layer cannot complete.
   */
  evaluate: (
    id: string,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<unknown>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}/evaluate`, {
      method: "POST",
      body: {},
      idempotencyKey,
      signal: o.signal,
    }),

  latestRecommendation: (id: string, o: Opts = {}): Promise<Result<Recommendation>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}/recommendations/latest`, {
      signal: o.signal,
    }),

  forecast: (id: string, o: Opts = {}): Promise<Result<ForecastBundle>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}/forecast`, { signal: o.signal }),

  water: (id: string, o: Opts = {}): Promise<Result<WaterEstimate>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}/water`, { signal: o.signal }),

  economics: (id: string, o: Opts = {}): Promise<Result<Economics>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}/economics`, { signal: o.signal }),

  journal: (id: string, o: ListOpts = {}): Promise<Result<Page<JournalEntry>>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}/journal`, {
      query: pageQuery(o),
      signal: o.signal,
    }),

  addJournalEntry: (
    id: string,
    body: JournalCreate,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<JournalEntry>> =>
    apiRequest(`/seasons/${encodeURIComponent(id)}/journal`, {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),
};

/* ── planning ────────────────────────────────────────────────────────────── */

export const planning = {
  /** Ranks eligible candidate crops. Fewer than five is a valid answer and the
   *  response explains the exclusions. */
  compare: (
    body: PlanningRequest,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<CropComparison>> =>
    apiRequest("/planning/compare", {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),
};

/* ── catalog ─────────────────────────────────────────────────────────────── */

export const catalog = {
  crops: (o: ListOpts = {}): Promise<Result<Page<Crop>>> =>
    apiRequest("/catalog/crops", { query: pageQuery(o), signal: o.signal }),

  products: (o: ListOpts = {}): Promise<Result<Page<Product>>> =>
    apiRequest("/catalog/products", { query: pageQuery(o), signal: o.signal }),

  locations: (
    o: ListOpts & { q?: string } = {},
  ): Promise<Result<Page<LocationResult>>> =>
    apiRequest("/catalog/locations", {
      query: { ...pageQuery(o), q: o.q },
      signal: o.signal,
    }),
};

/* ── tasks, notifications, reminders ─────────────────────────────────────── */

export const tasks = {
  list: (o: ListOpts = {}): Promise<Result<Page<Task>>> =>
    apiRequest("/tasks", { query: pageQuery(o), signal: o.signal }),

  patch: (
    id: string,
    body: { expected_version: number } & Record<string, unknown>,
    o: Opts = {},
  ): Promise<Result<Task>> =>
    apiRequest(`/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      signal: o.signal,
    }),
};

export const notifications = {
  list: (o: ListOpts = {}): Promise<Result<Page<Notification>>> =>
    apiRequest("/notifications", { query: pageQuery(o), signal: o.signal }),

  /** Marking a notification read acknowledges the message only. It is not
   *  evidence that the underlying farm work happened. */
  patch: (
    id: string,
    body: { expected_version: number } & Record<string, unknown>,
    o: Opts = {},
  ): Promise<Result<Notification>> =>
    apiRequest(`/notifications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      signal: o.signal,
    }),
};

export const reminders = {
  list: (o: ListOpts = {}): Promise<Result<Page<Reminder>>> =>
    apiRequest("/reminders", { query: pageQuery(o), signal: o.signal }),
};

/* ── conversations ───────────────────────────────────────────────────────── */

export const conversations = {
  create: (
    body: Record<string, unknown>,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<Conversation>> =>
    apiRequest("/conversations", {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),

  messages: (id: string, o: ListOpts = {}): Promise<Result<Page<Message>>> =>
    apiRequest(`/conversations/${encodeURIComponent(id)}/messages`, {
      query: pageQuery(o),
      signal: o.signal,
    }),

  /** 201. Stores the farmer's turn; the assistant's reply, if any, arrives as a
   *  separate message in the thread rather than in this response. */
  postMessage: (
    id: string,
    body: MessageCreate,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<Message>> =>
    apiRequest(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),
};

/**
 * Proposed mutations.
 *
 * The assistant may propose a change to the farmer's data; nothing is applied
 * until the farmer confirms that exact proposal. Confirmation is idempotent and
 * returns a receipt; cancelling has no side effect.
 *
 * `GET /proposals/{id}` returns the operation, target, expected_version and the
 * values it would write, so the farmer sees exactly what they are approving.
 */
export const proposals = {
  /** Read what a proposal would change, so Confirm is never a blind approval. */
  get: (id: string, o: Opts = {}): Promise<Result<ProposedMutation>> =>
    apiRequest(`/proposals/${encodeURIComponent(id)}`, { signal: o.signal }),

  confirm: (
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<MutationReceipt>> =>
    apiRequest(`/proposals/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      body: { expected_version: expectedVersion },
      idempotencyKey,
      signal: o.signal,
    }),

  cancel: (
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<MutationReceipt>> =>
    apiRequest(`/proposals/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: { expected_version: expectedVersion },
      idempotencyKey,
      signal: o.signal,
    }),
};

/* ── soil and jobs ───────────────────────────────────────────────────────── */

export const soil = {
  /** 202: extraction runs as a job and produces a DRAFT observation. Nothing
   *  becomes authoritative until the farmer confirms it. */
  extract: (
    body: Record<string, unknown>,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<Job>> =>
    apiRequest("/soil/extractions", {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),

  confirm: (
    id: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<SoilObservation>> =>
    apiRequest(`/soil/extractions/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),
};

export const jobs = {
  get: (id: string, o: Opts = {}): Promise<Result<Job>> =>
    apiRequest(`/jobs/${encodeURIComponent(id)}`, { signal: o.signal }),
};

/* ── media ───────────────────────────────────────────────────────────────── */

export const media = {
  /** 201: returns an upload ticket. The object is not usable until completed. */
  requestUpload: (
    body: Record<string, unknown>,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<unknown>> =>
    apiRequest("/media/uploads", {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),

  complete: (
    id: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<unknown>> =>
    apiRequest(`/media/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      body,
      idempotencyKey,
      signal: o.signal,
    }),

  /** Short-lived, owner-only read URL. Never cache or log the returned link. */
  access: (id: string, o: Opts = {}): Promise<Result<unknown>> =>
    apiRequest(`/media/${encodeURIComponent(id)}/access`, { signal: o.signal }),
};

/* ── reminders (mutations) ───────────────────────────────────────────────── */

export const reminderMutations = {
  create: (
    body: Record<string, unknown>,
    idempotencyKey: string,
    o: Opts = {},
  ): Promise<Result<Reminder>> =>
    apiRequest("/reminders", { method: "POST", body, idempotencyKey, signal: o.signal }),

  patch: (
    id: string,
    body: { expected_version: number } & Record<string, unknown>,
    o: Opts = {},
  ): Promise<Result<Reminder>> =>
    apiRequest(`/reminders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      signal: o.signal,
    }),

  remove: (id: string, o: Opts = {}): Promise<Result<unknown>> =>
    apiRequest(`/reminders/${encodeURIComponent(id)}`, { method: "DELETE", signal: o.signal }),
};

/* ── agronomist ──────────────────────────────────────────────────────────── */

/**
 * Role-gated. A farmer account answers 403 here, and that is the correct
 * result rather than an error to hide — the UI must not offer these views to
 * someone who cannot use them, and must never fake a role client-side.
 */
export const agronomist = {
  summary: (o: Opts = {}): Promise<Result<unknown>> =>
    apiRequest("/agronomist/summary", { signal: o.signal }),

  fields: (o: ListOpts = {}): Promise<Result<Page<Field>>> =>
    apiRequest("/agronomist/fields", { query: pageQuery(o), signal: o.signal }),

  stressMap: (o: ListOpts = {}): Promise<Result<Page<unknown>>> =>
    apiRequest("/agronomist/stress-map", { query: pageQuery(o), signal: o.signal }),

  evidence: (o: ListOpts = {}): Promise<Result<Page<unknown>>> =>
    apiRequest("/agronomist/evidence", { query: pageQuery(o), signal: o.signal }),

  models: (o: Opts = {}): Promise<Result<unknown>> =>
    apiRequest("/agronomist/models", { signal: o.signal }),
};
