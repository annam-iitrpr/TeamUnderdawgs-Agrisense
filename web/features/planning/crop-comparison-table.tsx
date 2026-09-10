"use client";

/**
 * Two or more crops side by side.
 *
 * Desktop puts crops in columns; a phone stacks them, and the metric order is
 * identical in both so a farmer scrolling on a phone compares the same rows in
 * the same sequence they would read across on a laptop.
 *
 * Deliberately absent: any percentage comparing one crop's yield to another's.
 * Rice and cotton are not comparable by mass, and "cotton yields 30% more than
 * rice" would be arithmetic with no meaning. A percentage only appears against
 * a crop's own stated baseline, which the engine supplies per crop or not at all.
 *
 * The net return row follows the same rule as the card it sits above: a
 * whole-season rupee total is withheld until the farmer has given a budget or
 * recorded costs. Side by side it would be worse than on a card, because two
 * modelled totals next to each other read as a ranking of what the farmer would
 * actually earn — the one comparison they are most likely to act on and the one
 * least entitled to be made from published averages alone.
 */
import { Button, Card } from "@/components/ui";
import type { Crop, CropPlan } from "@/lib/api/contract";
import { explainCode } from "@/lib/missing-reasons";
import { X } from "lucide-react";
import { EstimateBand } from "./estimate-band";
import { seasonReturnMode } from "./crop-card";
import { formatLitres, litresFromMeasurement } from "./water-figures";

/** A cell that says what is missing, in the space a table cell allows. */
function Missing({ code }: { code: string }) {
  return <span className="text-xs text-slate">{explainCode(code)}</span>;
}

type Row = {
  key: string;
  label: string;
  render: (plan: CropPlan, areaHa: number, budgetInr: number | null | undefined) => React.ReactNode;
};

const ROWS: Row[] = [
  {
    key: "suitability",
    label: "Suitability",
    render: (plan) => {
      const overall = plan.compatibility?.overall;
      return overall != null ? (
        <span translate="no" className="font-semibold tabular-nums">
          {Math.round(overall * 100)}%
        </span>
      ) : (
        <Missing code={plan.exclusions?.[0]?.code ?? "suitability_not_scored_for_this_field"} />
      );
    },
  },
  {
    key: "water",
    label: "Season water",
    render: (plan, areaHa) => {
      // Cubic metres from the planner, not a depth. See litresFromMeasurement.
      const litres = litresFromMeasurement(
        plan.water?.seasonal?.p50,
        plan.water?.seasonal?.unit,
        areaHa,
      );
      return litres != null ? (
        <span>
          <span translate="no" className="font-semibold tabular-nums">
            {formatLitres(litres)}
          </span>
          <span className="block text-xs text-slate">whole season</span>
        </span>
      ) : (
        <Missing
          code={
            plan.water?.seasonal?.missing_reason ??
            plan.water?.missing_reason ??
            "season_water_requirement_unavailable"
          }
        />
      );
    },
  },
  {
    key: "profit",
    label: "Net return",
    render: (plan, _areaHa, budgetInr) =>
      seasonReturnMode(plan.economics, budgetInr) === "withheld" ? (
        <Missing code="season_return_needs_your_budget_or_recorded_costs" />
      ) : (
        <EstimateBand estimate={plan.economics?.profit} label="" />
      ),
  },
  {
    key: "roi",
    label: "Return on spend",
    render: (plan, _areaHa, budgetInr) =>
      seasonReturnMode(plan.economics, budgetInr) === "withheld" ? (
        <Missing code="season_return_needs_your_budget_or_recorded_costs" />
      ) : (
        <EstimateBand estimate={plan.economics?.roi} label="" />
      ),
  },
  {
    key: "sowing",
    label: "Sow between",
    render: (plan) =>
      plan.sowing_interval ? (
        <span translate="no" className="text-sm tabular-nums">
          {plan.sowing_interval.start_date} to {plan.sowing_interval.end_date}
        </span>
      ) : (
        <Missing code="sowing_window_not_published_for_your_area" />
      ),
  },
  {
    key: "harvest",
    label: "Harvest",
    render: (plan) =>
      plan.harvest_interval ? (
        <span translate="no" className="text-sm tabular-nums">
          {plan.harvest_interval.start_date} to {plan.harvest_interval.end_date}
        </span>
      ) : (
        <Missing code="harvest_window_not_published_for_your_area" />
      ),
  },
  {
    key: "warnings",
    label: "Warnings",
    render: (plan) =>
      plan.exclusions && plan.exclusions.length > 0 ? (
        <ul className="list-inside list-disc text-sm">
          {plan.exclusions.slice(0, 3).map((r) => (
            <li key={r.code}>{explainCode(r.code)}</li>
          ))}
        </ul>
      ) : (
        <span className="text-slate">None</span>
      ),
  },
];

export function CropComparisonTable({
  plans,
  cropFor,
  areaHa,
  budgetInr,
  onClear,
}: {
  plans: CropPlan[];
  cropFor: (id: string) => Crop | null;
  areaHa: number;
  /** What the farmer said they can spend, when the caller knows it. Never defaulted. */
  budgetInr?: number | null;
  onClear: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          Comparing {plans.length} crops on the same <span translate="no">{areaHa} ha</span>
        </p>
        <Button variant="secondary" onClick={onClear}>
          <X aria-hidden className="size-4" />
          Clear
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate">
        Same area, same season and the same price assumptions for each. Yields of different
        crops are not compared by weight, because that comparison has no meaning.
      </p>

      {/* Desktop: crops across. The container scrolls rather than the page. */}
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[36rem] border-collapse text-left">
          <caption className="sr-only">Crop comparison for this field</caption>
          <thead>
            <tr>
              <th scope="col" className="w-40 pb-2 text-xs font-semibold text-slate">
                Metric
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.crop_id}
                  scope="col"
                  className="pb-2 text-sm font-semibold capitalize text-ink"
                >
                  {cropFor(plan.crop_id)?.name ?? plan.crop_id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-t border-mist">
                <th scope="row" className="py-2 pr-3 align-top text-xs font-normal text-slate">
                  {row.label}
                </th>
                {plans.map((plan) => (
                  <td key={plan.crop_id} className="py-2 pr-3 align-top">
                    {row.render(plan, areaHa, budgetInr)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: crops stacked, rows in the identical order. */}
      <div className="mt-3 space-y-3 md:hidden">
        {plans.map((plan) => (
          <div key={plan.crop_id} className="rounded-card border border-mist p-3">
            <p className="text-sm font-semibold capitalize text-ink">
              {cropFor(plan.crop_id)?.name ?? plan.crop_id}
            </p>
            <dl className="mt-2 space-y-1.5">
              {ROWS.map((row) => (
                <div key={row.key} className="flex justify-between gap-3">
                  <dt className="text-xs text-slate">{row.label}</dt>
                  <dd className="text-right">{row.render(plan, areaHa, budgetInr)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}
