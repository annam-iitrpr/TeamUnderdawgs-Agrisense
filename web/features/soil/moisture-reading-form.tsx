"use client";

/**
 * Recording a soil moisture reading the farmer took themselves.
 *
 * This is the one input the water balance cannot start without, and until now
 * there was no way to give it: soil observations came only from photographing a
 * Soil Health Card, which carries lab values dated months ago. So every water
 * figure in the product read "not known" no matter what the farmer did.
 *
 * Two things this is careful about:
 *
 *  - It asks for a basis rather than assuming one. Volumetric water content and
 *    percent-of-field-capacity are different quantities in different units, and
 *    a reading interpreted under the wrong one would produce a confidently wrong
 *    irrigation figure. Only volumetric is currently usable by the engine, and
 *    that is said rather than hidden.
 *  - It does not accept a future date, and it defaults to today rather than
 *    leaving the date blank, because a reading is nearly always taken when it
 *    is entered — but the farmer can correct it.
 */
import { Button, Callout, Card, TextField } from "@/components/ui";
import { newIdempotencyKey } from "@/lib/api/client";
import type { Field, MoistureBasis } from "@/lib/api/contract";
import { ApiError, fieldErrors } from "@/lib/api/envelope";
import { soil as soilApi } from "@/lib/api/routes";
import { cn } from "@/lib/utils";
import { Droplet } from "lucide-react";
import { useRef, useState } from "react";

/**
 * The engine derives root-zone depletion only from a volumetric reading in
 * m³/m³. The other two bases are in the contract and are accepted here so the
 * reading is not lost, but they are labelled as not yet usable rather than
 * being silently stored and ignored.
 */
const BASES: Array<{
  id: MoistureBasis;
  label: string;
  unit: string;
  hint: string;
  usable: boolean;
}> = [
  {
    id: "volumetric",
    label: "Volumetric",
    unit: "m³/m³",
    hint: "What most probes read. 0.24 means 24% of the soil volume is water.",
    usable: true,
  },
  {
    id: "percent_field_capacity",
    label: "Percent of field capacity",
    unit: "%",
    hint: "How full the soil is compared with after a good soaking.",
    usable: false,
  },
  {
    id: "gravimetric",
    label: "Gravimetric",
    unit: "kg/kg",
    hint: "By weight, from a dried sample.",
    usable: false,
  },
];

function todayInIst(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function MoistureReadingForm({
  field,
  onSaved,
  onCancel,
}: {
  field: Field;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [basis, setBasis] = useState<MoistureBasis>("volumetric");
  const [value, setValue] = useState("");
  const [depth, setDepth] = useState("30");
  const [sampledOn, setSampledOn] = useState(todayInIst);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perField, setPerField] = useState<Record<string, string>>({});

  // Reused across retries so a timeout followed by a second tap records one
  // reading rather than two readings for the same moment.
  const idempotencyKey = useRef(newIdempotencyKey());

  const selected = BASES.find((option) => option.id === basis)!;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const problems: Record<string, string> = {};
    const parsed = Number(value.trim().replace(",", "."));
    if (value.trim() === "") problems.moisture = "Enter the reading from your meter.";
    else if (!Number.isFinite(parsed)) problems.moisture = "Enter only a number.";
    else if (parsed < 0) problems.moisture = "This cannot be negative.";
    else if (basis === "volumetric" && parsed > 1) {
      // 0.24, not 24. A volumetric reading above 1 would mean the soil is more
      // than entirely water, and would silently produce a nonsense requirement.
      problems.moisture =
        "A volumetric reading is between 0 and 1. If your meter shows 24, enter 0.24.";
    } else if (basis === "percent_field_capacity" && parsed > 200) {
      problems.moisture = "That is higher than any meter reports.";
    }

    const parsedDepth = depth.trim() === "" ? null : Number(depth.trim().replace(",", "."));
    if (parsedDepth !== null && (!Number.isFinite(parsedDepth) || parsedDepth <= 0)) {
      problems.depth_cm = "Enter the depth in centimetres, or leave it blank.";
    }
    if (sampledOn > todayInIst()) {
      problems.sampled_on = "This is in the future. A reading records what you measured.";
    }

    if (Object.keys(problems).length > 0) {
      setPerField(problems);
      return;
    }
    setPerField({});

    setSaving(true);
    try {
      await soilApi.recordReading(
        {
          field_id: field.id,
          sampled_on: sampledOn,
          moisture: { value: parsed, unit: selected.unit },
          moisture_basis: basis,
          ...(parsedDepth === null ? {} : { depth_cm: parsedDepth }),
        },
        idempotencyKey.current,
      );
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fields = fieldErrors(cause);
        if (Object.keys(fields).length > 0) setPerField(fields);
        setError(cause.message);
      } else {
        setError("We cannot reach AgriSense right now. Nothing was saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" className="p-4">
      <h3 className="flex items-center gap-2 text-h3 font-semibold">
        <Droplet aria-hidden className="size-4 text-forest" />
        Soil moisture reading
      </h3>
      <p className="mt-1 text-sm text-slate">
        AgriSense cannot say how much water your crop needs without knowing how much is already
        in the soil. If you have a moisture meter, this is that number.
      </p>

      <form onSubmit={submit} noValidate className="mt-3 space-y-4">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">What does your meter show?</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {BASES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={basis === option.id}
                onClick={() => setBasis(option.id)}
                disabled={saving}
                className={cn(
                  "min-h-[44px] rounded-control border px-3 text-left text-sm font-semibold",
                  basis === option.id
                    ? "border-forest bg-forest text-white"
                    : "border-mist bg-card text-ink",
                )}
              >
                {option.label}
                <span
                  className={cn(
                    "block text-xs font-normal",
                    basis === option.id ? "text-white/80" : "text-slate",
                  )}
                >
                  {option.unit}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate">{selected.hint}</p>
        </fieldset>

        {/* Said plainly rather than storing a reading the engine will ignore. */}
        {!selected.usable ? (
          <Callout tone="caution" className="text-sm">
            This reading will be kept with your field, but AgriSense cannot use it for the water
            plan yet — only a volumetric reading works for that so far.
          </Callout>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={`Reading (${selected.unit})`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={perField.moisture}
            disabled={saving}
          />
          <TextField
            label="Depth (optional)"
            inputMode="decimal"
            hint="Centimetres. How deep the probe went."
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            error={perField.depth_cm}
            disabled={saving}
          />
        </div>

        <TextField
          label="When did you take it?"
          type="date"
          max={todayInIst()}
          hint="A water plan needs today's reading. An older one is still kept."
          value={sampledOn}
          onChange={(e) => setSampledOn(e.target.value)}
          error={perField.sampled_on}
          disabled={saving}
        />

        {error ? (
          <Callout tone="blocked" className="text-sm">
            {error}
          </Callout>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={saving} busyLabel="Saving" className="flex-1">
            Save the reading
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
