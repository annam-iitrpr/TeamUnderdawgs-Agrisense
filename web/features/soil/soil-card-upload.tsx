"use client";

/**
 * Upload a Soil Health Card and check what was read from it.
 *
 * The photo is transcribed, never interpreted: the model reads printed values
 * and does not decide whether a soil is deficient. Everything arrives as a
 * draft the farmer confirms, because a misread decimal point changes what goes
 * on a field. A value that could not be read stays empty with its reason shown;
 * it is never filled with a typical figure and never shown as zero.
 */
import { Button, Callout, Card, Skeleton, TextField } from "@/components/ui";
import { newIdempotencyKey } from "@/lib/api/client";
import type { Field, SoilObservation } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { jobs as jobsApi, soil as soilApi } from "@/lib/api/routes";
import { uploadAttachment, UploadError } from "@/lib/media/upload";
import { explainMissing } from "@/lib/missing-reasons";
import { FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";

type Stage =
  | { name: "idle" }
  | { name: "uploading" }
  | { name: "reading" }
  | { name: "review"; draft: SoilObservation }
  | { name: "saved" };

const READABLE: Record<string, string> = {
  ph: "pH",
  organic_carbon: "Organic carbon",
  nitrogen: "Nitrogen",
  phosphorus: "Phosphorus",
  potassium: "Potassium",
};
const FIELDS = ["ph", "organic_carbon", "nitrogen", "phosphorus", "potassium"] as const;

type Reading = { value?: number | null; unit?: string; missing_reason?: string | null } | null;

function readingOf(draft: SoilObservation, key: string): Reading {
  return (draft as unknown as Record<string, Reading>)[key] ?? null;
}

export function SoilCardUpload({ field, onSaved }: { field: Field; onSaved?: () => void }) {
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setStage({ name: "uploading" });
    try {
      const mediaId = await uploadAttachment(file, newIdempotencyKey());
      const { data: job } = await soilApi.extract(
        { field_id: field.id, media_id: mediaId },
        newIdempotencyKey(),
      );
      setStage({ name: "reading" });

      // Reading a card takes a few seconds. Waiting forever is worse than saying so.
      for (let attempt = 0; attempt < 25; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        const { data: state } = await jobsApi.get(job.id);
        if (state.status === "succeeded" && state.result_id) {
          const { data: draft } = await soilApi.get(state.result_id);
          setStage({ name: "review", draft });
          return;
        }
        if (state.status === "failed" || state.status === "dead_letter") {
          throw new Error(
            state.error?.message ?? "This card could not be read. Try a clearer, straighter photo.",
          );
        }
      }
      throw new Error("Reading the card is taking longer than expected. Try again in a moment.");
    } catch (cause) {
      setStage({ name: "idle" });
      setError(
        cause instanceof UploadError || cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The card could not be uploaded.",
      );
    }
  }

  if (stage.name === "review") {
    return (
      <ReviewDraft
        draft={stage.draft}
        onCancel={() => setStage({ name: "idle" })}
        onSaved={() => {
          setStage({ name: "saved" });
          onSaved?.();
        }}
      />
    );
  }

  if (stage.name === "saved") {
    return (
      <Callout tone="success" title="Soil test saved">
        Your soil values are recorded for {field.name} and are used in future advice.
      </Callout>
    );
  }

  const working = stage.name === "uploading" || stage.name === "reading";

  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <FileText aria-hidden className="size-4 text-forest" />
        Add your Soil Health Card
      </p>
      <p className="mt-1 text-sm text-slate">
        Photograph the card. AgriSense reads the printed values and shows them to you to check
        before anything is saved.
      </p>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />

      {error ? <p className="mt-3 text-sm text-clay">{error}</p> : null}

      {working ? (
        <div className="mt-3 space-y-2" aria-live="polite">
          <p className="text-sm text-slate">
            {stage.name === "uploading" ? "Uploading the photo…" : "Reading the card…"}
          </p>
          <Skeleton className="h-16 w-full rounded-card" />
        </div>
      ) : (
        <Button className="mt-3" onClick={() => input.current?.click()}>
          <Upload aria-hidden className="size-4" />
          Choose a photo
        </Button>
      )}
    </Card>
  );
}

function ReviewDraft({
  draft,
  onCancel,
  onSaved,
}: {
  draft: SoilObservation;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of FIELDS) {
      const reading = readingOf(draft, key);
      initial[key] = reading?.value != null ? String(reading.value) : "";
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const observation = structuredClone(draft) as unknown as Record<string, unknown>;
      for (const key of FIELDS) {
        const existing = observation[key] as Record<string, unknown> | null;
        if (!existing) continue;
        const raw = (values[key] ?? "").trim();
        const parsed = raw === "" ? null : Number(raw);
        const usable = parsed !== null && Number.isFinite(parsed);
        observation[key] = {
          ...existing,
          value: usable ? parsed : null,
          // A value the farmer cleared is unknown, and says so rather than reading as zero.
          missing_reason: usable
            ? null
            : ((existing.missing_reason as string | null) ?? "not_provided_by_farmer"),
        };
      }
      observation.confirmation_state = "confirmed";
      await soilApi.confirm(
        draft.id,
        { expected_version: draft.version, observation },
        newIdempotencyKey(),
      );
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "These values could not be saved.");
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <p className="text-sm font-semibold text-ink">Check what was read from your card</p>
      <p className="mt-1 text-sm text-slate">
        Correct anything that is wrong. A value AgriSense could not read is left empty — leave
        it empty rather than guessing.
      </p>

      <div className="mt-3 space-y-3">
        {FIELDS.map((key) => {
          const reading = readingOf(draft, key);
          if (!reading) return null;
          return (
            <div key={key}>
              <TextField
                label={`${READABLE[key] ?? key}${reading.unit ? ` (${reading.unit})` : ""}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={values[key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
              {(values[key] ?? "") === "" && reading.missing_reason ? (
                <p className="mt-1 text-xs text-slate">
                  Not read from the card: {explainMissing(reading.missing_reason)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-3 text-sm text-clay">{error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={save} busy={busy}>
          Save these values
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Discard
        </Button>
      </div>
    </Card>
  );
}
