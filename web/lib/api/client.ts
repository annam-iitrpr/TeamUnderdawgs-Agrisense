/**
 * The single auth-aware API client.
 *
 * Deliberate properties:
 *  - No browser-only auth is read at module scope. The token provider is
 *    injected, so importing this file during Next.js server rendering does not
 *    touch `window` or the Firebase SDK.
 *  - Every mutation that creates, evaluates, confirms or closes sends an
 *    `Idempotency-Key`, so a double tap or a retry cannot create two fields or
 *    two recommendations.
 *  - Every PATCH sends `expected_version`; a 409 surfaces as a recoverable
 *    version conflict rather than a generic failure.
 *  - Authenticated responses are never written to a shared cache. Callers pass
 *    an AbortSignal and drop stale results (see `lib/api/query.ts`).
 */
import {
  ApiError,
  codeForStatus,
  type Envelope,
  type Meta,
} from "./envelope";

export type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

/** Called once by the auth provider after Firebase initialises. */
export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000/api/v1";
}

/** A result plus the envelope metadata the UI renders as honesty labels. */
export type Result<T> = { data: T; meta: Meta };

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Required by the contract on create/evaluate/confirm/close. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Sent as a query param for list endpoints. */
  query?: Record<string, string | number | boolean | null | undefined>;
};

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${apiBase()}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<Result<T>> {
  const { method = "GET", body, idempotencyKey, signal, query } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const token = await tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // Authenticated data is never served from a shared HTTP cache.
      cache: "no-store",
      credentials: "omit",
    });
  } catch (cause) {
    // An abort is the caller's own cancellation, not a failure to report.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError({
      code: "network",
      status: 0,
      message: "We cannot reach AgriSense right now. Please try again in a moment.",
      retryable: true,
      details: cause,
    });
  }

  if (response.status === 204) {
    return { data: undefined as T, meta: emptyMeta() };
  }

  const payload = await safeJson(response);

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  const envelope = payload as Partial<Envelope<T>> | null;
  if (!envelope || typeof envelope !== "object" || !("data" in envelope)) {
    // A body that is not the agreed envelope is a contract violation, not
    // something to paper over by guessing at the shape.
    throw new ApiError({
      code: "unknown",
      status: response.status,
      message: "The server returned an unexpected response.",
      retryable: true,
      requestId: response.headers.get("x-request-id"),
      details: payload,
    });
  }

  return {
    data: envelope.data as T,
    meta: envelope.meta ?? emptyMeta(),
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toApiError(response: Response, payload: unknown): ApiError {
  const code = codeForStatus(response.status);
  const requestId = response.headers.get("x-request-id");

  const envelopeError =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { code?: string; message?: string; details?: unknown; retryable?: boolean } }).error
      : undefined;

  return new ApiError({
    code,
    serverCode: envelopeError?.code ?? null,
    status: response.status,
    message: envelopeError?.message ?? fallbackMessage(code),
    retryable: envelopeError?.retryable,
    requestId:
      requestId ??
      (payload && typeof payload === "object" && "request_id" in payload
        ? String((payload as { request_id?: unknown }).request_id)
        : null),
    details: envelopeError?.details,
  });
}

function fallbackMessage(code: ReturnType<typeof codeForStatus>): string {
  switch (code) {
    case "unauthenticated":
      return "Please sign in again.";
    case "forbidden":
      return "You do not have access to this.";
    case "not_found":
      return "We could not find that.";
    case "version_conflict":
      return "This was changed elsewhere. Refresh and try again.";
    case "invalid_input":
      return "Please check the highlighted fields.";
    case "rate_limited":
      return "Too many requests. Wait a moment and try again.";
    case "dependency_unavailable":
      return "A service AgriSense depends on is unavailable right now.";
    default:
      return "Something went wrong. Please try again.";
  }
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
