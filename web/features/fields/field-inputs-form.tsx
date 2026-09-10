"use client";

/**
 * Editing the field facts the engine needs but onboarding allowed to be skipped.
 *
 * These used to be "requests" that linked to `/onboarding`, which starts a new
 * field rather than editing this one — so the pill could never be satisfied.
 * The values are edited here, against this field, with its version.
 *
 * Water and cash are not optional detail. The planning engine excludes a crop
 * outright when it cannot check the crop's requirement against what the farmer
 * actually has, so a field without them gets no crop comparison at all — which
 * surfaces to a farmer as "nothing suits my field" unless it is spelled out.
 */
import { Button, Callout, Card, TextField } from "@/components/ui";
import type { Field } from "@/lib/api/contract";
import { ApiError, fieldErrors } from "@/lib/api/envelope";
import { fields as fieldsApi } from "@/lib/api/routes";
import { cn } from "@/lib/utils";
import { useState } from "react";

const METHODS = ["rainfed", "flood", "furrow", "sprinkler", "drip"] as const;

/** A typed figure, or null when blank; `undefined` means "leave unchanged". */
function parseOptional(raw: string, original: number | null | undefined): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return original == null ? undefined : null;
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value === original ? undefined : value;
}

export function FieldInputsForm({
  field,
  onSaved,
  onCancel,
}: {
  field: Field;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [water, setWater] = useState(
    field.available_water_m3 == null ? "" : String(field.available_water_m3),
  );
  const [budget, setBudget] = useState(
    field.water_budget_inr == null ? "" : String(field.water_budget_inr),
  );
  const [method, setMethod] = useState<string | null>(field.irrigation_method ?? null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perField, setPerField] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPerField({});

    const problems: Record<string, string> = {};
    for (const [key, raw] of [
      ["available_water_m3", water],
      ["water_budget_inr", budget],
    ] as const) {
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      const value = Number(trimmed.replace(",", "."));
      if (!Number.isFinite(value)) problems[key] = "Enter only a number.";
      else if (value <= 0) problems[key] = "Enter a figure above zero, or leave it blank.";
    }
    if (Object.keys(problems).length > 0) {
      setPerField(problems);
      return;
    }

    const nextWater = parseOptional(water, field.available_water_m3);
    const nextBudget = parseOptional(budget, field.water_budget_inr);
    const nextMethod =
      method === (field.irrigation_method ?? null) ? undefined : (method ?? null);

    // Nothing changed: saying so beats a request that pointlessly bumps the version.
    if (nextWater === undefined && nextBudget === undefined && nextMethod === undefined) {
      onCancel();
      return;
    }

    setSaving(true);
    try {
      await fieldsApi.patch(field.id, {
        expected_version: field.version,
        ...(nextWater === undefined ? {} : { available_water_m3: nextWater }),
        ...(nextBudget === undefined ? {} : { water_budget_inr: nextBudget }),
        ...(nextMethod === undefined ? {} : { irrigation_method: nextMethod }),
      });
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fields = fieldErrors(cause);
        if (Object.keys(fields).length > 0) setPerField(fields);
        setError(
          cause.status === 409
            ? "This field was changed somewhere else while you were editing. Reopen it and try again."
            : cause.message,
        );
      } else {
        setError("We cannot reach AgriSense right now. Please try again in a moment.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" className="p-4">
      <h3 className="text-h3 font-semibold">What you can spend on a season</h3>
      <p className="mt-1 text-sm text-slate">
        AgriSense will not suggest a crop that needs more water or money than you have, so it
        needs both before it can compare crops. Leave one blank and it stays unknown rather
        than being treated as zero.
      </p>

      <form onSubmit={submit} noValidate className="mt-3 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Water you can use"
            inputMode="decimal"
            hint="Cubic metres for the whole season. 1 m³ is 1000 litres."
            value={water}
            onChange={(e) => setWater(e.target.value)}
            error={perField.available_water_m3}
            disabled={saving}
          />
          <TextField
            label="Money you can spend"
            inputMode="decimal"
            hint="Rupees for the whole season."
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            error={perField.water_budget_inr}
            disabled={saving}
          />
        </div>

        <fieldset>
          <legend className="text-sm font-semibold text-ink">How do you water it?</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {METHODS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={method === option}
                onClick={() => setMethod(method === option ? null : option)}
                disabled={saving}
                className={cn(
                  "min-h-[44px] rounded-control border px-4 text-sm font-semibold capitalize",
                  method === option
                    ? "border-forest bg-forest text-white"
                    : "border-mist bg-card text-ink",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        {error ? (
          <Callout tone="blocked" className="text-sm">
            {error}
          </Callout>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={saving} busyLabel="Saving" className="flex-1">
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
