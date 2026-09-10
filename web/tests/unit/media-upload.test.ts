import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/envelope";

const requestUpload = vi.fn();
const complete = vi.fn();

vi.mock("@/lib/api/routes", () => ({
  media: {
    requestUpload: (...args: unknown[]) => requestUpload(...args),
    complete: (...args: unknown[]) => complete(...args),
  },
}));

// jsdom's Blob has no arrayBuffer(); every browser the app supports has had it
// since 2019, so this stands in for the platform rather than for the module.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

const { ACCEPTED_IMAGE_TYPES, UploadError, uploadAttachment } = await import("@/lib/media/upload");

/** sha256("hello"), so the digest sent to the server is checked, not assumed. */
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

const ticket = {
  asset: { id: "med_1", content_type: "image/jpeg", size_bytes: 5, status: "pending", received_at: "", version: 1 },
  upload_url: "https://storage.example/put/med_1",
  method: "PUT" as const,
  expires_at: "",
  headers: { "x-goog-meta-tenant": "t1" },
};

function photo(type = "image/jpeg"): File {
  return new File(["hello"], "photo.jpg", { type });
}

beforeEach(() => {
  requestUpload.mockReset();
  complete.mockReset();
  requestUpload.mockResolvedValue({ data: ticket, meta: {} });
  complete.mockResolvedValue({ data: { ...ticket.asset, status: "ready" }, meta: {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
});

describe("uploadAttachment", () => {
  it("tickets, stores the bytes and completes with the real digest", async () => {
    const id = await uploadAttachment(photo(), "idem-1");

    expect(id).toBe("med_1");
    expect(requestUpload).toHaveBeenCalledWith(
      { filename: "photo.jpg", content_type: "image/jpeg", size_bytes: 5 },
      "idem-1",
    );

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ticket.upload_url);
    expect(init.method).toBe("PUT");
    // The store signs the headers it issued; adding one gets the PUT rejected.
    expect(init.headers).toEqual(ticket.headers);

    expect(complete).toHaveBeenCalledWith("med_1", { sha256: HELLO_SHA256 }, "idem-1");
  });

  it("accepts a content type that carries parameters", async () => {
    await uploadAttachment(photo("image/jpeg; charset=binary"), "idem-1");
    expect(requestUpload.mock.calls[0]?.[0]).toMatchObject({ content_type: "image/jpeg" });
  });

  it("refuses a type the contract does not accept, before any request", async () => {
    await expect(uploadAttachment(photo("image/gif"), "idem-1")).rejects.toBeInstanceOf(UploadError);
    await expect(uploadAttachment(photo(""), "idem-1")).rejects.toBeInstanceOf(UploadError);
    expect(requestUpload).not.toHaveBeenCalled();
  });

  it("refuses a file over the contract's 20 MB ceiling without uploading it", async () => {
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });
    await expect(uploadAttachment(big, "idem-1")).rejects.toThrow("20 MB or less");
    expect(requestUpload).not.toHaveBeenCalled();
  });

  it("does not complete an upload whose bytes were rejected by the store", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    await expect(uploadAttachment(photo(), "idem-1")).rejects.toThrow(/expired/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("reports the server's own message when the ticket is refused", async () => {
    requestUpload.mockRejectedValue(
      new ApiError({ code: "invalid_input", status: 413, message: "Choose a file of 20 MB or less." }),
    );
    await expect(uploadAttachment(photo(), "idem-1")).rejects.toThrow("Choose a file of 20 MB or less.");
  });

  it("offers only types a camera or gallery produces", () => {
    expect([...ACCEPTED_IMAGE_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});
