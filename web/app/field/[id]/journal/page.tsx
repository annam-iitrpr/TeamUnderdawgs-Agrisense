"use client";

import { PhoneFrame } from "@/components/phone-frame";
import { useApp } from "@/components/providers";
import { BuildSprint, Button, Card, ErrorState } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Camera, Check, Mic } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";

const ENTRY_TYPES = [
  { value: "spray", key: "journalSprayed" as const },
  { value: "skipped", key: "journalSkipped" as const },
  { value: "observation", key: "journalObserved" as const },
];

export default function JournalPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { t } = useApp();
  const router = useRouter();

  const [entryType, setEntryType] = useState("spray");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const entry = await api.addJournal(id, {
        entry_type: entryType,
        text,
        actual_spray_at: entryType === "spray" ? new Date().toISOString() : null,
      });
      if (photo) await api.uploadPhoto(entry.item.id, photo);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "We could not save your entry.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("journalTitle")}>
        <div className="animate-rise flex min-h-[24rem] flex-col items-center justify-center gap-4 p-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sprout)_16%,transparent)]">
            <Check aria-hidden className="size-7 text-forest" />
          </span>
          <p className="max-w-[30ch] text-h3 font-semibold tracking-tight">
            {t("journalSaved")}
          </p>
          <div className="flex w-full max-w-[18rem] flex-col gap-2">
            <Button size="lg" onClick={() => router.push(`/field/${id}/history`)}>
              {t("seasonHistory")}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                setSaved(false);
                setText("");
                setPhoto(null);
                setPreview(null);
              }}
            >
              {t("journalPrompt")}
            </Button>
          </div>
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame backHref={`/field/${id}`} title={t("journalTitle")}>
      <div className="animate-rise space-y-4 p-4">
        {error ? (
          <ErrorState
            title={t("errorTitle")}
            message={error}
            retryLabel={t("retry")}
            onRetry={save}
          />
        ) : null}

        <fieldset>
          <legend className="text-h3 font-semibold tracking-tight">
            {t("journalPrompt")}
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {ENTRY_TYPES.map((e) => (
              <button
                key={e.value}
                onClick={() => setEntryType(e.value)}
                aria-pressed={entryType === e.value}
                className={cn(
                  "min-h-[44px] rounded-full border px-4 text-sm font-semibold transition-colors duration-[120ms]",
                  entryType === e.value
                    ? "border-forest bg-forest text-white"
                    : "border-mist bg-card text-ink",
                )}
              >
                {t(e.key)}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label
            htmlFor="journal-note"
            className="text-sm font-semibold text-slate"
          >
            {t("journalNote")}
          </label>
          <textarea
            id="journal-note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="mt-1.5 w-full rounded-control border border-mist bg-card p-3 text-body outline-none focus-visible:border-forest"
            placeholder="Anything you noticed on the field"
          />
        </div>

        <div>
          <label
            htmlFor="journal-photo"
            className="text-sm font-semibold text-slate"
          >
            {t("journalAddPhoto")}
          </label>
          <input
            ref={fileRef}
            id="journal-photo"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setPhoto(f);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
          <Button
            variant="secondary"
            size="lg"
            className="mt-1.5 w-full"
            onClick={() => fileRef.current?.click()}
          >
            <Camera aria-hidden className="size-5" />
            {photo ? photo.name.slice(0, 28) : t("journalAddPhoto")}
          </Button>
          {preview ? (
            // A local object URL, so next/image would add nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="The photo you selected for this journal entry"
              className="mt-2 h-40 w-full rounded-control border border-mist object-cover"
            />
          ) : null}
        </div>

        <BuildSprint
          label={t("journalVoice")}
          note="Voice notes need the WhatsApp channel, which lands in the Build Sprint."
        />

        <Button size="lg" className="w-full" onClick={save} disabled={saving}>
          {saving ? t("loading") : t("journalSave")}
        </Button>
      </div>
    </PhoneFrame>
  );
}
