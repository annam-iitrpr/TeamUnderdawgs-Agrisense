/**
 * Error handling and envelope helpers.
 *
 * The types themselves now come from the generated contract via `./contract`.
 * This file holds only the behaviour the UI needs on top of them: mapping an
 * HTTP status to something a screen can react to, deciding whether a retry
 * could plausibly help, and pulling field-level messages out of a 422.
 */
import type { DataMode, ErrorDetail, Meta, Provenance } from "./contract";

export type { DataMode, ErrorDetail, Meta, Provenance };

export type Envelope<T> = { data: T; meta: Meta };

/** Structural page shape; concrete routes return the generated page type. */
export type Page<T> = { items: T[]; next_cursor?: string | null };

/**
 * A value the server could not determine, with the reason.
 *
 * The contract expresses this per-field (a nullable value beside a
 * `missing_reason`, as on `Measurement`). This wrapper is for the places where
 * Phase 1 carries the pair around internally. It exists so that "unknown" and
 * "zero" stay distinguishable in component props — the contract is clear that
 * an unknown must never render as 0.
 */
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

/** Maps the statuses the contract assigns to each condition. */
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

  /**
   * True when a dependency the server needs is unavailable.
   *
   * This is a first-class, expected state rather than a bug: Phase 3 answers
   * 503 `DEPENDENCY_UNAVAILABLE` when, for example, no `ReferenceBundle` can be
   * built, and the UI must say so honestly instead of showing a fabricated
   * result or a generic failure.
   */
  get isDependencyUnavailable(): boolean {
    return this.code === "dependency_unavailable";
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
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
    else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
  }
  return out;
}

/**
 * Metadata for responses that carry none (204s, and non-conforming bodies we
 * still accept). `unavailable` is the honest default: it must never present as
 * `live`.
 */
export function emptyMeta(): Meta {
  return {
    request_id: "",
    schema_version: "1.0",
    data_mode: "unavailable",
    generated_at: new Date().toISOString(),
    provenance: [],
    warnings: [],
  };
}
