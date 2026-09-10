/**
 * Upload a photo, a scanned card or a voice note, and return its media id.
 *
 * The contract keeps bytes out of the API: a ticket authorises exactly one
 * object, the bytes go straight to storage, and the asset only becomes readable
 * once the server has verified the stored bytes against the digest declared
 * here. So an upload is three steps, not one, and every screen that attaches a
 * file does them in the same order:
 *
 *   1. `POST /media/uploads`        → an upload ticket (id, URL, headers)
 *   2. `PUT` the file to that URL   → the bytes, never through the API
 *   3. `POST /media/{id}/complete`  → the sha256, which the server re-computes
 *
 * Failures surface as `UploadError` with a farmer-readable message, so an
 * attachment that could not be stored is never silently dropped from the
 * message, journal entry or soil card it belonged to.
 */
import { ApiError } from "@/lib/api/envelope";
import type { MediaContentType } from "@/lib/api/contract";
import { media as mediaApi } from "@/lib/api/routes";

/** What a camera or gallery picker may offer. Cards are photographed, so no PDF. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Every type `UploadRequest.content_type` allows. The server also sniffs the bytes. */
const ACCEPTED_CONTENT_TYPES: readonly MediaContentType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
];

/** The contract's own ceiling (`size_bytes` ≤ 20 MiB), checked before the round trip. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export class UploadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UploadError";
  }
}

function acceptedType(value: string): MediaContentType | null {
  // A picker can hand back "image/jpeg; charset=binary" or an empty string.
  const bare = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return ACCEPTED_CONTENT_TYPES.find((type) => type === bare) ?? null;
}

async function sha256Hex(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    // Only available over HTTPS and on localhost. Without it the digest the
    // server verifies cannot be computed, so the upload cannot be completed.
    throw new UploadError("This browser cannot upload files over an insecure connection.");
  }
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A server message is already farmer-facing; a transport failure is not. */
function readable(cause: unknown, fallback: string): UploadError {
  if (cause instanceof UploadError) return cause;
  if (cause instanceof ApiError) return new UploadError(cause.message, { cause });
  return new UploadError(fallback, { cause });
}

/**
 * Stores `file` and resolves with the media id to attach to a message, a
 * journal entry or a soil card extraction.
 *
 * `idempotencyKey` covers the ticket and the completion, so a retried tap
 * cannot leave two half-uploaded assets behind.
 */
export async function uploadAttachment(file: File, idempotencyKey: string): Promise<string> {
  const contentType = acceptedType(file.type);
  if (!contentType) {
    throw new UploadError("This kind of file cannot be attached. Use a photo, a PDF or a voice note.");
  }
  if (file.size <= 0) {
    throw new UploadError("This file is empty.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("Choose a file of 20 MB or less.");
  }

  // Computed before the ticket: a file the browser cannot read is not worth an
  // asset row the server then has to expire.
  const sha256 = await sha256Hex(file);

  let ticket;
  try {
    ({ data: ticket } = await mediaApi.requestUpload(
      { filename: file.name, content_type: contentType, size_bytes: file.size },
      idempotencyKey,
    ));
  } catch (cause) {
    throw readable(cause, "The upload could not be started. Try again in a moment.");
  }

  let stored: Response;
  try {
    stored = await fetch(ticket.upload_url, {
      method: ticket.method ?? "PUT",
      // The ticket carries whatever the store requires; nothing is added, because
      // a header the signature did not cover is rejected by the store.
      headers: ticket.headers ?? {},
      body: file,
      cache: "no-store",
      credentials: "omit",
    });
  } catch (cause) {
    throw new UploadError("The file could not be sent. Check your connection and try again.", {
      cause,
    });
  }
  if (!stored.ok) {
    throw new UploadError(
      stored.status === 403
        ? "The upload link expired before the file finished. Try again."
        : "The file could not be stored. Try again.",
    );
  }

  try {
    const { data: asset } = await mediaApi.complete(ticket.asset.id, { sha256 }, idempotencyKey);
    return asset.id;
  } catch (cause) {
    throw readable(cause, "The upload could not be confirmed. Try again.");
  }
}
