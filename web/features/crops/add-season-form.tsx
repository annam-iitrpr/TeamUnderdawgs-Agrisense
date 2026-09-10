"use client";

/**
 * Add a crop to a field.
 *
 * The crop list is the reviewed catalogue, never a hardcoded one. Area is
 * validated against what is still unallocated, because a field's area cannot be
 * promised twice: two seasons each claiming the whole field would double every
 * water and money estimate derived from them.
 */
import { Button, Callout, Card, Skeleton, TextField } from "@/components/ui";
import { useCrops } from "@/features/crops/use-crop-name";
import { newIdempotencyKey } from "@/lib/api/client";
import type { Field, Season } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { fields as fieldsApi } from "@/lib/api/routes";
import { formatArea } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Check, Sprout } from "lucide-react";
import { useState } from "react";

export function AddSeasonForm({
  field,
  existingSeasons,
  onAdded,
  onCancel,
}: {
  field: Field;
  existingSeasons: Season[];
  onAdded: (season: Season) => void;
  onCancel?: () => void;
}) {
  const { crops, isLoading } = useCrops();
  const allocated = existingSeasons
    .filter((s) => s.status !== "closed")
    .reduce((sum, s) => sum + (s.allocated_area_ha ?? 0), 0);
  const remaining = Math.max(0, Number((field.area_ha - allocated).toFixed(4)));
  /**
   * What the input can actually hold. Its step is 0.01, and a value off that
   * grid fails the browser's own validation — so offering the free area to four
   * decimals made "Add this crop" refuse to submit with "the nearest valid
   * value is 1.01", for every field whose area is not a round hundredth. A
   * field entered in acres is never one: 2.5 acres is 1.011714 ha.
   *
   * Floored, not rounded, because rounding up offers land the field has not got.
   */
  const offerable = Math.floor(remaining * 100) / 100;

  const [cropId, setCropId] = useState("");
  const [area, setArea] = useState(String(offerable));
  const [sowingDate, setSowingDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const areaValue = Number(area);
  const areaInvalid = !Number.isFinite(areaValue) || areaValue <= 0 || areaValue > offerable + 1e-9;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!cropId || areaInvalid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await fieldsApi.createSeason(
        field.id,
        {
          crop_id: cropId,
          allocated_area_ha: areaValue,
          status: "active",
          ...(sowingDate
            ? { sowing_date: sowingDate, date_confidence: "confirmed" as const }
            : {}),
        },
        newIdempotencyKey(),
      );
      onAdded(data);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.status === 422 && /allocation/i.test(cause.message)
            ? "That is more land than this field has left. Reduce the area."
            : cause.message
          : "The crop could not be added. Check your connection.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Skeleton className="h-48 w-full rounded-card" />;

  if (crops.length === 0) {
    return (
      <Callout tone="caution" title="No crops to choose from">
        The reviewed crop catalogue is empty right now, so there is no list to choose from. Your
        field is saved; add the crop once it is available.
      </Callout>
    );
  }

  if (offerable <= 0) {
    return (
      <Callout tone="info" title="This field is fully allocated">
        There is no unallocated land left in {field.name} to add a crop to. Close a season, or
        reduce its area, before adding another.
      </Callout>
    );
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Which crop?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {crops.map((crop) => (
              <button
                key={crop.id}
                type="button"
                onClick={() => setCropId(crop.id)}
                aria-pressed={cropId === crop.id}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-2 rounded-control border px-3 text-sm font-semibold transition-colors",
                  cropId === crop.id
                    ? "border-forest bg-forest text-white"
                    : "border-mist bg-card text-ink hover:border-forest/50",
                )}
              >
                {cropId === crop.id ? (
                  <Check aria-hidden className="size-4" />
                ) : (
                  <Sprout aria-hidden className="size-4 text-forest" />
                )}
                {crop.name}
              </button>
            ))}
          </div>
          {cropId && !crops.find((c) => c.id === cropId)?.supported_for_biological_advice ? (
            <p className="mt-2 text-xs text-slate">
              This crop can be planned and recorded, but AgriSense does not give biological
              product advice for it.
            </p>
          ) : null}
        </fieldset>

        <TextField
          label={`Area in hectares (${formatArea(offerable, "ha")} left of ${formatArea(field.area_ha, "ha")})`}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          max={String(offerable)}
          value={area}
          onChange={(e) => setArea(e.target.value)}
          error={
            areaInvalid && area !== ""
              ? `Enter between 0.01 and ${formatArea(offerable, "ha")}.`
              : undefined
          }
        />

        <TextField
          label="Sowing date (leave blank if you are not sure)"
          type="date"
          value={sowingDate}
          onChange={(e) => setSowingDate(e.target.value)}
        />

        {error ? <p className="text-sm text-clay">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy} disabled={!cropId || areaInvalid}>
            Add this crop
          </Button>
          {onCancel ? (
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
