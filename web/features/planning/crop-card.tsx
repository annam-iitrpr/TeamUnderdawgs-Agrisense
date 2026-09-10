"use client";

/**
 * One candidate crop, with everything the PRD asks a farmer to weigh.
 *
 * Water appears in millimetres and in litres for this field's own area, because
 * a depth means nothing to someone filling a channel. Every figure that the
 * engine could not produce says so; none of them fall back to zero, since a zero
 * water requirement or a zero return would be a claim rather than a blank.
 */
import { Button, Callout, Card } from "@/components/ui";
import { MarketPricePanel } from "@/features/market/market-price-panel";
import { EstimateBand } from "./estimate-band";
import { ScoreMeter } from "./score-meter";
import { formatLitres, litresFromMeasurement } from "./water-figures";
import type { Crop, CropPlan } from "@/lib/api/contract";
import { cn } from "@/lib/utils";
import { explainCode } from "@/lib/missing-reasons";
import { CalendarDays, Check, Droplets, Scissors, TriangleAlert } from "lucide-react";

function windowLabel(interval: { start_date: string; end_date: string } | null | undefined): string | null {
  if (!interval) return null;
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    });
  return interval.start_date === interval.end_date
    ? fmt(interval.start_date)
    : `${fmt(interval.start_date)} – ${fmt(interval.end_date)}`;
}

function seasonLengthDays(plan: CropPlan): number | null {
  if (!plan.sowing_interval || !plan.harvest_interval) return null;
  const sow = Date.parse(`${plan.sowing_interval.start_date}T00:00:00Z`);
  const cut = Date.parse(`${plan.harvest_interval.end_date}T00:00:00Z`);
  if (!Number.isFinite(sow) || !Number.isFinite(cut) || cut <= sow) return null;
  return Math.round((cut - sow) / 86_400_000);
}

export function CropCard({
  plan,
  crop,
  areaHa,
  rank,
  waterScore,
  state,
  selected,
  onToggleCompare,
  onChoose,
  choosing,
}: {
  plan: CropPlan;
  crop: Crop | null;
  areaHa: number;
  rank?: number;
  waterScore: number | null;
  /** The farmer's state, so "nearest mandi" means one they could reach. */
  state?: string | null;
  selected?: boolean;
  onToggleCompare?: () => void;
  onChoose?: () => void;
  choosing?: boolean;
}) {
  const compatibility = plan.compatibility ?? {};
  const overall = compatibility.overall ?? null;
  const reasons = Object.entries(compatibility).filter(([key]) => key !== "overall");
  // The planner returns the seasonal requirement in cubic metres, not
  // millimetres. It was being labelled "mm" and then converted as though it
  // were a depth over the area, which both mislabelled it and multiplied it by
  // the area a second time.
  const seasonalLitres = litresFromMeasurement(
    plan.water?.seasonal?.p50,
    plan.water?.seasonal?.unit,
    areaHa,
  );
  const days = seasonLengthDays(plan);
  const sowing = windowLabel(plan.sowing_interval);
  const harvest = windowLabel(plan.harvest_interval);

  return (
    <Card className={cn("p-4", selected && "ring-2 ring-forest")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-h3 font-semibold capitalize text-ink">
            {rank ? <span className="text-sm text-slate">#{rank}</span> : null}
            {crop?.name ?? plan.crop_id}
          </p>
          {crop && !crop.supported_for_biological_advice ? (
            <p className="mt-0.5 text-xs text-slate">
              Planning only — no biological product advice for this crop.
            </p>
          ) : null}
        </div>
        {onToggleCompare ? (
          <Button
            variant="secondary"
            onClick={onToggleCompare}
            aria-pressed={selected}
            className={cn(selected && "border-forest text-forest")}
          >
            {selected ? <Check aria-hidden className="size-4" /> : null}
            {selected ? "Comparing" : "Compare"}
          </Button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ScoreMeter
          score={overall}
          label="Suitability for this field"
          missingReason={
            plan.exclusions?.[0]?.code ? explainCode(plan.exclusions[0].code) : undefined
          }
        />
        {/* What this crop needs on this land, not how it ranks against the
            others. A farmer deciding what to sow needs the volume they have to
            find; "needs least of the five" tells them nothing about whether
            they can meet it. The depth is shown too, because that is the form
            an agronomist can check the figure in. */}
        <div>
          <p className="text-xs text-slate">Water this crop needs on your land</p>
          {seasonalLitres != null ? (
            <>
              <p className="mt-0.5 text-h3 font-semibold tabular-nums text-ink">
                {formatLitres(seasonalLitres)}
              </p>
              <p className="text-xs text-slate">
                whole season on {areaHa} ha
                {areaHa > 0
                  ? ` · about ${Math.round(seasonalLitres / (areaHa * 10000))} mm`
                  : ""}
                {/* This is the crop's water requirement for the season (FAO
                    IWM 3, table 5), not what is left after rain. Saying rain
                    was already counted would understate what a farmer has to
                    find. Rain is subtracted day by day in the water plan, once
                    there is a sown crop and a forecast to subtract. */}
                . Rain during the season covers part of this.
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-sm text-slate">
              Needs the season&rsquo;s rainfall and reference water use for this crop.
            </p>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="flex items-center gap-1 text-xs text-slate">
            <Droplets aria-hidden className="size-3.5" /> Season water
          </dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {seasonalLitres != null ? (
              <>
                {formatLitres(seasonalLitres)}
                <span className="block text-xs font-normal text-slate">
                  for your {areaHa} ha, whole season
                </span>
              </>
            ) : (
              <span className="text-slate">Not known</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-slate">
            <CalendarDays aria-hidden className="size-3.5" /> Sow between
          </dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {sowing ?? <span className="text-slate">Not known</span>}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-slate">
            <Scissors aria-hidden className="size-3.5" /> Harvest
          </dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {harvest ?? <span className="text-slate">Not known</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Season length</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {days != null ? `${days} days` : <span className="text-slate">Not known</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid gap-3 border-t border-mist pt-3 sm:grid-cols-3">
        <EstimateBand estimate={plan.economics?.profit} label="Net return" emphasis />
        <EstimateBand estimate={plan.economics?.roi} label="Return on spend" />
        <EstimateBand estimate={plan.economics?.cost} label="Expected cost" />
      </div>

      {/* What the crop is actually fetching right now. This is the one money
          figure on the card that is real: the return estimates above need
          reviewed yield and cost records that do not exist yet, while a mandi
          price is an observation from this morning. */}
      <div className="mt-3">
        <MarketPricePanel
          cropId={plan.crop_id}
          cropName={crop?.name ?? plan.crop_id}
          state={state}
          harvestFrom={plan.harvest_interval?.start_date ?? null}
        />
      </div>

      {plan.economics?.price?.value != null ? (
        <p className="mt-2 text-xs text-slate">
          Priced at ₹{plan.economics.price.value}/{plan.economics.price.unit}
          {plan.economics.price_date ? ` on ${plan.economics.price_date}` : ""}
          {plan.economics.price_source ? ` · ${plan.economics.price_source}` : ""}
        </p>
      ) : null}

      {reasons.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {reasons.map(([key, value]) => (
            <li
              key={key}
              className="rounded-full border border-mist px-2 py-0.5 text-xs text-slate"
            >
              {key.replace(/_/g, " ")}
              {value != null ? `: ${Math.round(value * 100)}%` : ": not known"}
            </li>
          ))}
        </ul>
      ) : null}

      {plan.exclusions && plan.exclusions.length > 0 ? (
        <Callout tone="caution" className="mt-3 text-sm" title="Warnings for this crop">
          <ul className="list-inside list-disc">
            {plan.exclusions.slice(0, 4).map((reason) => (
              <li key={reason.code}>{explainCode(reason.code)}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {plan.suitability_evidence_ids && plan.suitability_evidence_ids.length === 0 ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-ink" />
          No reviewed regional evidence yet, so these figures are a scenario rather than a
          calibrated forecast.
        </p>
      ) : null}

      {onChoose ? (
        <Button className="mt-4 w-full sm:w-auto" onClick={onChoose} busy={choosing}>
          Choose {crop?.name ?? plan.crop_id}
        </Button>
      ) : null}
    </Card>
  );
}
