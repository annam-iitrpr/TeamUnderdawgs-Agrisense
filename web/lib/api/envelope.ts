/**
 * The v1 response envelope and error shape.
 *
 * PROVISIONAL. `contracts/openapi.yaml` does not exist yet and generated types
 * are Phase 3-owned (`web/lib/generated/**`). These declarations are written
 * from the build spec's tables so Phase 1 can be built and tested now; they are
 * replaced by generated types when the bootstrap lands. Tracked as
 * interface-requests.md IR-003.
 */

/** How much of what is on screen is real. Rendered as a visible badge. */
export type DataMode = "live" | "estimated" | "demo" | "mixed" | "unavailable";

export type Provenance = {
  source: string;
  live: boolean;
  fetched_at: string | null;
  /** Present when a different provider stood in for the intended one. */
  substituted_for?: string | null;
  note?: string | null;
};

export type Meta = {
  request_id: string;
  schema_version: string;
  data_mode: DataMode;
  generated_at: string;
  provenance: Provenance[];
  warnings: string[];
  /** Present on 202 responses. */
  job_id?: string | null;
};

export type Envelope<T> = { data: T; meta: Meta };

/** Lists are keyset-paginated; `next_cursor` null means the end. */
export type Page<T> = { items: T[]; next_cursor: string | null };

/** A value the server could not determine, with the reason it could not.
 *  Unknown is never represented as 0. */
export type Unknowable<T> = { value: T | null; unknown_reason?: string | null };

/* ────────────────────────────────────────────────────────────────── errors */

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "version_conflict"
  | "invalid_input"
  | "rate_limited"
  | "dependency_unavailable"
  | "network"
  | "unknown";

/** Maps the HTTP statuses the spec assigns to each condition. */
export function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "version_conflict";
    case 422:
      return "invalid_input";
    case 429:
      return "rate_limited";
    case 503:
      return "dependency_unavailable";
    default:
      return "unknown";
  }
}

/**
 * An API failure carrying enough structure for the UI to react correctly:
 * refresh a token, re-fetch after a version conflict, show a field-level
 * validation message, or offer a retry.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(init: {
    code: ApiErrorCode;
    status: number;
    message: string;
    retryable?: boolean;
    requestId?: string | null;
    details?: unknown;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable ?? defaultRetryable(init.code);
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? null;
  }

  /** True when re-authenticating could plausibly fix this. */
  get isAuthFailure(): boolean {
    return this.code === "unauthenticated";
  }

  /** True when the client holds a stale `expected_version` and should refetch. */
  get isVersionConflict(): boolean {
    return this.code === "version_conflict";
  }
}

function defaultRetryable(code: ApiErrorCode): boolean {
  switch (code) {
    case "rate_limited":
    case "dependency_unavailable":
    case "network":
    case "unknown":
      return true;
    default:
      return false;
  }
}

/** Field-level validation messages, keyed by input name, for 422 responses. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== "invalid_input") return {};
  const details = error.details;
  if (!details || typeof details !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
  }
  return out;
}
