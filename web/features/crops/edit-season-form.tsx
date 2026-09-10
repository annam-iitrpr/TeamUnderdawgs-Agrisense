"use client";

/**
 * Edit one crop in place.
 *
 * A farmer with three crops on a field had no way to correct one of them: the
 * only route to a sowing date or an area was creating the season again, which
 * the allocation check then refused. This patches the one season, so the other
 * crops on the field are untouched.
 *
 * Only what the contract's SeasonPatch accepts is offered. The crop itself is
 * not in it and is not editable here by design — a different crop is a
 * different season with its own journal, not a renamed one.
 *
 * Every field is left blank-able only where the contract allows it, and an
 * unchanged field is not sent at all: the server merges what it is given, so
 * echoing untouched values back would overwrite a concurrent change with stale
 * data of our own making.
 */
import { Button, Callout, Card, TextField } from "@/components/ui";
import { freeAreaHa } from "@/features/crops/allocation";
import { cropIcon } from "@/features/crops/crop-identity";
import type { Field, Season, SeasonPatch } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { seasons as seasonsApi } from "@/lib/api/routes";
import { formatArea } from "@/lib/format";
import { useState } from "react";

export function EditSeasonForm({
  field,
  season,
  fieldSeasons,
  cropName,
  onSaved,
  onCancel,
}: {
  field: Field;
  season: Season;
  /** Every season on this field, so the free area accounts for the others. */
  fieldSeasons: Season[];
  cropName: string;
  onSaved: (season: Season) => void;
  onCancel: () => void;
}) {
  const Icon = cropIcon(season.crop_id);
  const offerable = freeAreaHa(field.area_ha, fieldSeasons, season.id);

  const [variety, setVariety] = useState(season.variety ?? "");
  const [sowingDate, setSowingDate] = useState(season.sowing_date ?? "");
  const [area, setArea] = useState(String(season.allocated_area_ha));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const areaValue = Number(area);
  const areaInvalid = !Number.isFinite(areaValue) || areaValue <= 0 || areaValue > offerable + 1e-9;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (areaInvalid || busy) return;
    setBusy(true);
    setError(null);

    const patch: SeasonPatch = { expected_version: season.version };
    if (variety.trim() !== (season.variety ?? "")) {
      // Emptying the box clears the variety rather than storing "", which the
      // contract models as null and every reader treats as "not recorded".
      patch.variety = variety.trim() === "" ? null : variety.trim();
    }
    if (sowingDate !== (season.sowing_date ?? "")) {
      patch.sowing_date = sowingDate === "" ? null : sowingDate;
      // A date the farmer just typed is a date they are sure of. Clearing it
      // returns the season to not knowing, which is not the same as estimated.
      patch.date_confidence = sowingDate === "" ? "unknown" : "confirmed";
    }
    if (Math.abs(areaValue - season.allocated_area_ha) > 1e-9) {
      patch.allocated_area_ha = areaValue;
    }

    try {
      const { data } = await seasonsApi.patch(season.id, patch);
      onSaved(data);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.status === 409
            ? "This crop changed somewhere else while you were editing. Reopen it and make the change again — nothing here has been saved."
            : cause.status === 422 && /allocation/i.test(cause.message)
              ? "That is more land than this field has left. Reduce the area."
              : cause.message
          : "The change could not be saved. Check your connection.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-h3 font-semibold">
        <Icon aria-hidden className="size-4 shrink-0 text-forest" />
        Edit {cropName}
      </p>
      <p className="mt-1 text-xs text-slate">
        Only this crop changes. The other crops on {field.name} are left as they are.
      </p>

      <form onSubmit={submit} className="mt-3 space-y-4">
        <TextField
          label="Variety (leave blank if you are not sure)"
          value={variety}
          onChange={(e) => setVariety(e.target.value)}
          disabled={busy}
        />

        <TextField
          label="Sowing date"
          type="date"
          value={sowingDate}
          onChange={(e) => setSowingDate(e.target.value)}
          hint="Clearing this records that the date is not known, rather than guessing one."
          disabled={busy}
        />

        <TextField
          label={`Area in hectares (up to ${formatArea(offerable, "ha")} on this field)`}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          max={String(offerable)}
          value={area}
          onChange={(e) => setArea(e.target.value)}
          disabled={busy}
          error={
            areaInvalid && area !== ""
              ? `Enter between 0.01 and ${formatArea(offerable, "ha")}.`
              : undefined
          }
        />

        {error ? (
          <Callout tone="blocked" className="text-sm">
            {error}
          </Callout>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy} busyLabel="Saving" disabled={areaInvalid}>
            Save this crop
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
