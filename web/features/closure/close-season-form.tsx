"use client";

/**
 * P1-10 — ending a season, and recording what actually happened.
 *
 * This is the only screen whose numbers are facts rather than estimates, and
 * that changes how it has to behave. Everything the farmer types here becomes
 * the record every earlier forecast is later scored against, so:
 *
 *  - Nothing is pre-filled from a forecast. Offering the predicted yield as a
 *    default would quietly turn the prediction into its own evidence, and the
 *    scoring that follows would be measuring the app against itself.
 *  - Closing is refused rather than repeated. `expected_version` means a season
 *    closed twice, or changed underneath, errors instead of overwriting an
 *    outcome record.
 *  - Every field is required, because a partial outcome cannot be scored and a
 *    zero is not the same as a blank. A farmer who genuinely sold nothing
 *    enters 0 deliberately.
 *  - It is spelled out that this ends the season, since it cannot be undone
 *    from here.
 */
import { Button, Callout, Card, TextField } from "@/components/ui";
import { newIdempotencyKey } from "@/lib/api/client";
import type { Season, SeasonEvaluation } from "@/lib/api/contract";
import { ApiError, fieldErrors } from "@/lib/api/envelope";
import { seasons as seasonsApi } from "@/lib/api/routes";
import { cn } from "@/lib/utils";
import { TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";

/** The forms a harvest is actually weighed and sold in. */
const PRODUCT_FORMS = ["grain", "seed_cotton", "paddy", "lint", "fodder"] as const;

/**
 * Moisture basis is not a formality.
 *
 * The same physical harvest weighs materially differently wet and dry, so a
 * yield without its basis cannot be compared with a reference figure or with
 * another season. There is no default: guessing it would silently bias every
 * later comparison.
 */
const MOISTURE_BASES = [
  { id: "as_received", label: "As weighed", hint: "Straight off the field, undried" },
  { id: "dry_basis", label: "Dry basis", hint: "After drying to a standard moisture" },
] as const;

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

type Numbers = {
  harvest_quantity_kg: string;
  harvested_area_ha: string;
  realized_sales_inr: string;
  realized_costs_inr: string;
};

export function CloseSeasonForm({
  season,
  cropName,
  onClosed,
  onCancel,
}: {
  season: Season;
  cropName: string;
  onClosed: (evaluation: SeasonEvaluation) => void;
  onCancel: () => void;
}) {
  const [numbers, setNumbers] = useState<Numbers>({
    harvest_quantity_kg: "",
    // The allocated area is a fact the farmer already gave us about this
    // season, not a prediction, so offering it is help rather than leading.
    harvested_area_ha: String(season.allocated_area_ha),
    realized_sales_inr: "",
    realized_costs_inr: "",
  });
  const [productForm, setProductForm] = useState<string | null>(null);
  const [moistureBasis, setMoistureBasis] = useState<string | null>(null);
  const [harvestedOn, setHarvestedOn] = useState(todayInIst);
  const [confirmed, setConfirmed] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perField, setPerField] = useState<Record<string, string>>({});

  // One key for this form, reused on retry: a timeout followed by a second tap
  // must not close the season twice.
  const idempotencyKey = useRef(newIdempotencyKey());

  function set<K extends keyof Numbers>(key: K, value: string) {
    setNumbers((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const problems: Record<string, string> = {};
    const parsed: Record<keyof Numbers, number> = {} as Record<keyof Numbers, number>;

    for (const key of Object.keys(numbers) as (keyof Numbers)[]) {
      const raw = numbers[key].trim();
      if (raw === "") {
        problems[key] = "Required. A blank cannot be scored, and it is not the same as zero.";
        continue;
      }
      const value = Number(raw.replace(",", "."));
      if (!Number.isFinite(value)) problems[key] = "Enter only a number.";
      else if (value < 0) problems[key] = "This cannot be negative.";
      else parsed[key] = value;
    }
    if (parsed.harvested_area_ha != null && parsed.harvested_area_ha === 0) {
      problems.harvested_area_ha = "Enter the area you actually harvested.";
    }
    if (
      parsed.harvested_area_ha != null &&
      parsed.harvested_area_ha > season.allocated_area_ha + 1e-6
    ) {
      problems.harvested_area_ha = `This season covers ${season.allocated_area_ha} ha. You cannot harvest more than that.`;
    }
    if (!productForm) problems.product_form = "Say what form the harvest was weighed in.";
    if (!moistureBasis) problems.moisture_basis = "Say whether it was weighed wet or dry.";
    if (harvestedOn > todayInIst()) {
      problems.harvested_on = "This is in the future. A closure records a harvest that happened.";
    }

    if (Object.keys(problems).length > 0) {
      setPerField(problems);
      return;
    }
    setPerField({});

    setSaving(true);
    try {
      const { data } = await seasonsApi.close(
        season.id,
        {
          expected_version: season.version,
          harvest_quantity_kg: parsed.harvest_quantity_kg,
          harvested_area_ha: parsed.harvested_area_ha,
          realized_sales_inr: parsed.realized_sales_inr,
          realized_costs_inr: parsed.realized_costs_inr,
          product_form: productForm!,
          moisture_basis: moistureBasis!,
          harvested_on: harvestedOn,
        },
        idempotencyKey.current,
      );
      onClosed(data);
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fields = fieldErrors(cause);
        if (Object.keys(fields).length > 0) setPerField(fields);
        setError(
          cause.status === 409
            ? "This season changed since you opened this form — it may already be closed. Reload and check before entering it again."
            : cause.message,
        );
      } else {
        setError("We cannot reach AgriSense right now. Nothing was saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  const yieldPerHa =
    Number(numbers.harvest_quantity_kg.replace(",", ".")) > 0 &&
    Number(numbers.harvested_area_ha.replace(",", ".")) > 0
      ? Number(numbers.harvest_quantity_kg.replace(",", ".")) /
        Number(numbers.harvested_area_ha.replace(",", "."))
      : null;
  const margin =
    numbers.realized_sales_inr.trim() !== "" && numbers.realized_costs_inr.trim() !== ""
      ? Number(numbers.realized_sales_inr.replace(",", ".")) -
        Number(numbers.realized_costs_inr.replace(",", "."))
      : null;

  return (
    <Card as="section" className="p-4">
      <h2 className="text-h3 font-semibold">End the {cropName} season</h2>
      <p className="mt-1 text-sm text-slate">
        What you enter here is the record AgriSense measures its own forecasts against. Nothing
        is filled in from a prediction, so the comparison stays honest.
      </p>

      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="How much did you harvest?"
            inputMode="decimal"
            hint="Total weight in kilograms."
            value={numbers.harvest_quantity_kg}
            onChange={(e) => set("harvest_quantity_kg", e.target.value)}
            error={perField.harvest_quantity_kg}
            disabled={saving}
          />
          <TextField
            label="Area you harvested"
            inputMode="decimal"
            hint={`In hectares. This season covers ${season.allocated_area_ha} ha.`}
            value={numbers.harvested_area_ha}
            onChange={(e) => set("harvested_area_ha", e.target.value)}
            error={perField.harvested_area_ha}
            disabled={saving}
          />
        </div>

        {yieldPerHa != null ? (
          <p className="text-xs text-slate">
            That works out to {Math.round(yieldPerHa).toLocaleString("en-IN")} kg per hectare.
          </p>
        ) : null}

        <fieldset>
          <legend className="text-sm font-semibold text-ink">
            What form was it weighed in?
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRODUCT_FORMS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={productForm === option}
                onClick={() => setProductForm(option)}
                disabled={saving}
                className={cn(
                  "min-h-[44px] rounded-control border px-3 text-sm font-semibold",
                  productForm === option
                    ? "border-forest bg-forest text-white"
                    : "border-mist bg-card text-ink",
                )}
              >
                {option.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          {perField.product_form ? (
            <p className="mt-1 text-xs text-clay">{perField.product_form}</p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-ink">Wet or dry?</legend>
          <p className="mt-0.5 text-xs text-slate">
            The same harvest weighs differently wet and dry, so a yield cannot be compared
            without this.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MOISTURE_BASES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={moistureBasis === option.id}
                onClick={() => setMoistureBasis(option.id)}
                disabled={saving}
                className={cn(
                  "min-h-[44px] rounded-control border px-3 text-left text-sm font-semibold",
                  moistureBasis === option.id
                    ? "border-forest bg-forest text-white"
                    : "border-mist bg-card text-ink",
                )}
              >
                {option.label}
                <span
                  className={cn(
                    "block text-xs font-normal",
                    moistureBasis === option.id ? "text-white/80" : "text-slate",
                  )}
                >
                  {option.hint}
                </span>
              </button>
            ))}
          </div>
          {perField.moisture_basis ? (
            <p className="mt-1 text-xs text-clay">{perField.moisture_basis}</p>
          ) : null}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="What did you sell it for?"
            inputMode="decimal"
            hint="Total rupees received. Enter 0 if you have not sold any."
            value={numbers.realized_sales_inr}
            onChange={(e) => set("realized_sales_inr", e.target.value)}
            error={perField.realized_sales_inr}
            disabled={saving}
          />
          <TextField
            label="What did the season cost you?"
            inputMode="decimal"
            hint="Total rupees spent, everything included."
            value={numbers.realized_costs_inr}
            onChange={(e) => set("realized_costs_inr", e.target.value)}
            error={perField.realized_costs_inr}
            disabled={saving}
          />
        </div>

        {margin != null ? (
          <p className="text-sm text-ink">
            Your margin was{" "}
            <span className={cn("font-semibold", margin < 0 ? "text-clay" : "text-forest")}>
              ₹{Math.round(margin).toLocaleString("en-IN")}
            </span>
            {margin < 0 ? " — a loss." : "."}
          </p>
        ) : null}

        <TextField
          label="When did you harvest?"
          type="date"
          max={todayInIst()}
          value={harvestedOn}
          onChange={(e) => setHarvestedOn(e.target.value)}
          error={perField.harvested_on}
          disabled={saving}
        />

        {/* Closing cannot be undone from here, so it takes a deliberate second
            action rather than a single tap on a primary button. */}
        <Callout tone="caution" title="This ends the season">
          <p>
            The {cropName} season closes and stops receiving advice. Your journal, records and
            this outcome are all kept.
          </p>
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={saving}
              className="mt-0.5 size-4 shrink-0"
            />
            <span>I have entered the real figures and want to end this season.</span>
          </label>
        </Callout>

        {error ? (
          <Callout tone="blocked" className="text-sm" title="Nothing was saved">
            {error}
          </Callout>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="lg"
            busy={saving}
            busyLabel="Closing"
            disabled={!confirmed}
            className="flex-1"
          >
            <TriangleAlert aria-hidden className="size-4" />
            End the season
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
