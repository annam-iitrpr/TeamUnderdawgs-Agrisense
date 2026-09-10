"use client";

import { formatArea } from "@/lib/format";

/**
 * One candidate crop, with everything the PRD asks a farmer to weigh.
 *
 * Water appears in millimetres and in litres for this field's own area, because
 * a depth means nothing to someone filling a channel. Every figure that the
 * engine could not produce says so; none of them fall back to zero, since a zero
 * water requirement or a zero return would be a claim rather than a blank.
 *
 * The money on this card leads with the per-quintal mandi price. It used to
 * lead with a whole-season "Net return" in rupees, which was the wrong figure
 * twice over: a farmer who has entered no budget and recorded no costs has
 * given us nothing for that total to be built from, and the total the engine
 * returns is a resampled scenario from published records with `basis:
 * "scenario"` and an evidence trail that calls itself indicative and
 * unreviewed. Set in the largest type on the card it read as *their* season's
 * profit. A price per quintal is the figure a farmer already checks and can
 * verify at the gate, so that is the headline, and the season total is held
 * back until they have supplied a budget or costs of their own.
 */
import { Button, Callout, Card, Skeleton } from "@/components/ui";
import { MarketPricePanel, rupeesPerQuintal } from "@/features/market/market-price-panel";
import { useMarketPrices } from "@/features/market/use-market-prices";
import { EstimateBand } from "./estimate-band";
import { ScoreMeter } from "./score-meter";
import { formatLitres, litresFromMeasurement } from "./water-figures";
import type { Crop, CropPlan, Economics } from "@/lib/api/contract";
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

/**
 * How much of a claim the whole-season money figures are entitled to make.
 *
 *  - `own`         the estimate has left `scenario` behind, so it was built
 *                  from records rather than from published averages. Only then
 *                  is a rupee total the farmer's own number.
 *  - `indicative`  the farmer has said what they can spend, so a modelled
 *                  season against that budget is worth seeing — labelled as the
 *                  scenario it is, and never as the headline.
 *  - `withheld`    a scenario total with nothing of the farmer's behind it.
 *                  The figure exists and is deliberately not shown: presented
 *                  in rupees it reads as a promise about their field, and the
 *                  more useful thing to say is which of their own numbers would
 *                  turn it into one.
 *  - `unavailable` the engine produced no figure at all, and says why itself.
 *
 * Withholding a number the engine did compute is the uncomfortable case, so it
 * is worth being exact about the reason: the scenario is a resample of paired
 * yield, price and cost rows published for the crop, scaled by area alone. It
 * knows nothing about this farmer's inputs, labour or land, and the difference
 * between that and their season is the entire question they came here to ask.
 */
export type SeasonReturnMode = "own" | "indicative" | "withheld" | "unavailable";

export function seasonReturnMode(
  economics: Economics | null | undefined,
  budgetInr: number | null | undefined,
): SeasonReturnMode {
  const profit = economics?.profit;
  if (!profit || profit.p50 == null) return "unavailable";
  if (profit.basis !== "scenario") return "own";
  // Zero is a stated budget of nothing rather than a budget, and negative is
  // not a budget at all; neither earns the season total a place on the card.
  return budgetInr != null && Number.isFinite(budgetInr) && budgetInr > 0
    ? "indicative"
    : "withheld";
}

export function CropCard({
  plan,
  crop,
  areaHa,
  rank,
  waterScore,
  state,
  budgetInr,
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
  /**
   * What the farmer said they can spend on this field, when the caller knows
   * it. Absent means absent: it is never defaulted, because a defaulted budget
   * is exactly the invented input that would let a modelled season total pass
   * itself off as the farmer's own.
   */
  budgetInr?: number | null;
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
  const waterMissing =
    plan.water?.seasonal?.missing_reason ??
    plan.water?.missing_reason ??
    "season_water_requirement_unavailable";
  const days = seasonLengthDays(plan);
  const sowing = windowLabel(plan.sowing_interval);
  const harvest = windowLabel(plan.harvest_interval);

  // One request per card for this crop's prices. The headline below and the
  // detail panel further down are two views of this single answer.
  const market = useMarketPrices(plan.crop_id, state);
  const modal = rupeesPerQuintal(market.prices?.modal);
  const low = rupeesPerQuintal(market.prices?.low);
  const high = rupeesPerQuintal(market.prices?.high);
  // The most common price is what "wheat is fetching" means. Falling back to
  // the range keeps the headline honest when no modal price came through;
  // falling back to the low alone would quietly understate the crop.
  const headline = modal ?? (low && high ? `${low} – ${high}` : null);
  const mandis = market.prices?.quotes?.length ?? 0;
  const returnMode = seasonReturnMode(plan.economics, budgetInr);

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

      {/* The headline. A price per quintal is an observation from this morning
          that the farmer can check against what their neighbour was offered;
          every other money figure on this card is modelled. It leads for that
          reason alone, not because it is the largest number available. */}
      <div className="mt-3 rounded-card border border-mist p-3">
        <p className="text-xs text-slate">
          What {(crop?.name ?? plan.crop_id).toLowerCase()} is fetching at mandis today
        </p>
        {market.loading ? (
          <Skeleton className="mt-1 h-8 w-40 rounded-control" />
        ) : headline ? (
          <>
            <p translate="no" className="mt-0.5 text-h2 font-semibold tabular-nums text-ink">
              {headline}
            </p>
            <p className="mt-0.5 text-xs text-slate">
              {modal && low && high ? (
                <>
                  {"Across mandis "}
                  <span translate="no">
                    {low} – {high}
                  </span>
                  {". "}
                </>
              ) : null}
              {mandis > 0
                ? `${mandis} mandi${mandis === 1 ? "" : "s"} reporting.`
                : "Indicative reference price for this season."}
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-sm text-slate">
            {explainCode("no_mandi_reported_this_crop_today")}
          </p>
        )}

        {/* The other half of what a price is worth: how much there is to sell.
            No yield reaches the browser — `Economics` carries cost, revenue,
            profit, roi and a price, and no weight per hectare anywhere — so
            this says what is missing instead of dividing a modelled revenue by
            a price to manufacture one. */}
        <div className="mt-2 border-t border-mist pt-2">
          <p className="text-xs text-slate">Expected yield per hectare</p>
          <p className="mt-0.5 text-sm text-slate">
            {explainCode("reviewed_yield_per_hectare_unavailable")}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ScoreMeter
          score={overall}
          label="Suitability for this field"
          missingReason={
            plan.exclusions?.[0]?.code ?? "suitability_not_scored_for_this_field"
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
              <p translate="no" className="mt-0.5 text-h3 font-semibold tabular-nums text-ink">
                {formatLitres(seasonalLitres)}
              </p>
              {/* Two sentences, two elements. Run together, a translator read
                  "whole season on 2 ha, about 550 mm. Rain covers part of
                  this." as "about 550 mm of rain falls" -- turning the crop's
                  requirement into the rainfall that meets it, which is the
                  opposite claim. Kept apart, neither can absorb the other. */}
              <p className="text-xs text-slate">
                whole season on <span translate="no">{formatArea(areaHa, "ha")}</span>
                {areaHa > 0 ? (
                  <>
                    {" · depth "}
                    <span translate="no">
                      {Math.round(seasonalLitres / (areaHa * 10000))} mm
                    </span>
                  </>
                ) : null}
              </p>
              {/* The crop's water requirement for the season (FAO IWM 3, table
                  5), not what is left after rain: saying rain was already
                  deducted would understate what a farmer has to find. Rain is
                  subtracted day by day in the water plan, where there is a sown
                  crop and a forecast to subtract. */}
              <p className="text-xs text-slate">
                Rain during the season covers part of this.
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-sm text-slate">{explainCode(waterMissing)}</p>
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
                <span translate="no" className="tabular-nums">
                  {formatLitres(seasonalLitres)}
                </span>
                <span className="block text-xs font-normal text-slate">
                  for your <span translate="no">{formatArea(areaHa, "ha")}</span>, whole season
                </span>
              </>
            ) : (
              <span className="text-xs font-normal text-slate">{explainCode(waterMissing)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-slate">
            <CalendarDays aria-hidden className="size-3.5" /> Sow between
          </dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {sowing ? (
              <span translate="no">{sowing}</span>
            ) : (
              <span className="text-xs font-normal text-slate">
                {explainCode("sowing_window_not_published_for_your_area")}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-slate">
            <Scissors aria-hidden className="size-3.5" /> Harvest
          </dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {harvest ? (
              <span translate="no">{harvest}</span>
            ) : (
              <span className="text-xs font-normal text-slate">
                {explainCode("harvest_window_not_published_for_your_area")}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Season length</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {days != null ? (
              <span translate="no" className="tabular-nums">
                {days} days
              </span>
            ) : (
              <span className="text-xs font-normal text-slate">
                {explainCode("season_length_needs_sowing_and_harvest_windows")}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* The season total, and what it is allowed to claim. See
          `seasonReturnMode`: with no budget and no recorded costs there is
          nothing of the farmer's in the arithmetic, so the rupee figures stay
          off the card and the card says which of their numbers would bring
          them back.

          Deliberately absent: `economics.price`. The engine sends it as a null
          measurement in INR/kg carrying its own reason — the price inside the
          scenario is a spread of past sales, not a quote anyone could sell at.
          A second price in a second unit next to a per-quintal headline is a
          hundred-fold mix-up waiting to happen, and the headline is the price
          worth acting on. */}
      <div className="mt-3 border-t border-mist pt-3">
        {returnMode === "withheld" ? (
          <>
            <p className="text-xs text-slate">Net return for the whole season</p>
            <p className="mt-0.5 text-sm text-slate">
              {explainCode("season_return_needs_your_budget_or_recorded_costs")}
            </p>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <EstimateBand
                estimate={plan.economics?.profit}
                label={returnMode === "own" ? "Net return" : "Net return, indicative"}
                emphasis={returnMode === "own"}
              />
              <EstimateBand estimate={plan.economics?.roi} label="Return on spend" />
              <EstimateBand estimate={plan.economics?.cost} label="Expected cost" />
            </div>
            {returnMode === "indicative" ? (
              <p className="mt-2 text-xs text-slate">
                Worked out from published records for this crop and your area, not from your own
                costs. Record what you spend and these become your figures.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* The detail behind the headline: which mandis, how far, and the support
          price the range is judged against. */}
      <div className="mt-3">
        <MarketPricePanel
          cropName={crop?.name ?? plan.crop_id}
          market={market}
          harvestFrom={plan.harvest_interval?.start_date ?? null}
        />
      </div>

      {reasons.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {reasons.map(([key, value]) => (
            <li
              key={key}
              className="rounded-full border border-mist px-2 py-0.5 text-xs text-slate"
            >
              {key.replace(/_/g, " ")}
              {value != null ? (
                <span translate="no" className="tabular-nums">
                  : {Math.round(value * 100)}%
                </span>
              ) : (
                ": not scored"
              )}
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
