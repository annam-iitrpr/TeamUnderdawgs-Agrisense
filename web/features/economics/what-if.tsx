"use client";

/**
 * "What if" — the farmer's own scenario, kept visibly separate from the engine's.
 *
 * Every figure here is identity arithmetic on the engine's own numbers: sales
 * are yield times price, net return is sales minus cost, and return on spend is
 * net return over cost. Nothing agronomic is recalculated. Changing the price a
 * farmer expects does not change how much the crop will grow, and this screen
 * does not pretend otherwise — it only reprices what the engine already said.
 *
 * The result is labelled "Your scenario" throughout and is never saved. It is a
 * sum a farmer could do on paper, done faster.
 */
import { Button, Callout, Card, TextField } from "@/components/ui";
import type { Economics } from "@/lib/api/contract";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

function rupees(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : ""}₹${Math.abs(rounded).toLocaleString("en-IN")}`;
}

export function WhatIf({ economics }: { economics: Economics }) {
  const baseRevenue = economics.revenue?.p50 ?? null;
  const baseCost = economics.cost?.p50 ?? null;
  const basePrice = economics.price?.value ?? null;

  const [open, setOpen] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [costInput, setCostInput] = useState("");
  const [yieldPercent, setYieldPercent] = useState("100");

  const usable = baseRevenue != null && baseCost != null;

  const scenario = useMemo(() => {
    if (!usable) return null;
    const yieldFactor = Number(yieldPercent) / 100;
    if (!Number.isFinite(yieldFactor) || yieldFactor < 0) return null;

    // Price only moves revenue if the engine gave a price to move from.
    const priceFactor =
      basePrice != null && priceInput.trim() !== "" && Number(priceInput) > 0
        ? Number(priceInput) / basePrice
        : 1;

    const revenue = (baseRevenue as number) * yieldFactor * priceFactor;
    const cost =
      costInput.trim() !== "" && Number.isFinite(Number(costInput)) && Number(costInput) >= 0
        ? Number(costInput)
        : (baseCost as number);
    const profit = revenue - cost;
    // A percentage of zero spend is not a large return, it is undefined.
    const roi = cost > 0 ? (profit / cost) * 100 : null;
    return { revenue, cost, profit, roi };
  }, [usable, baseRevenue, baseCost, basePrice, priceInput, costInput, yieldPercent]);

  const edited =
    priceInput.trim() !== "" || costInput.trim() !== "" || yieldPercent.trim() !== "100";

  if (!usable) {
    return (
      <Callout tone="info" className="text-sm" title="Nothing to try yet">
        Trying different prices or costs needs a starting estimate from the engine. Once this
        season has one, you can change the assumptions here and see what it would mean.
      </Callout>
    );
  }

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm font-semibold text-ink"
      >
        <SlidersHorizontal aria-hidden className="size-4 text-forest" />
        What if the price, yield or cost were different?
      </button>

      {open ? (
        <>
          <p className="mt-2 text-xs text-slate">
            This reprices what the engine already estimated. It does not change how much the
            crop will grow, and nothing here is saved.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <TextField
              label={`Price per ${economics.price?.unit ?? "unit"}${basePrice != null ? ` (now ₹${basePrice})` : ""}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              placeholder={basePrice != null ? String(basePrice) : "Not priced"}
              disabled={basePrice == null}
            />
            <TextField
              label="Yield, as % of expected"
              type="number"
              inputMode="numeric"
              min="0"
              max="300"
              step="5"
              value={yieldPercent}
              onChange={(e) => setYieldPercent(e.target.value)}
            />
            <TextField
              label="Total cost you plan to spend"
              type="number"
              inputMode="decimal"
              min="0"
              step="100"
              value={costInput}
              onChange={(e) => setCostInput(e.target.value)}
              placeholder={String(Math.round(baseCost as number))}
            />
          </div>

          {scenario ? (
            <div
              className={`mt-4 rounded-card border p-3 ${edited ? "border-forest bg-[color-mix(in_srgb,var(--sprout)_8%,transparent)]" : "border-mist"}`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-forest">
                {edited ? "Your scenario" : "The engine's estimate"}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate">Sales</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{rupees(scenario.revenue)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate">Cost</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{rupees(scenario.cost)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate">Net return</dt>
                  <dd
                    className={`mt-0.5 font-semibold tabular-nums ${scenario.profit < 0 ? "text-clay" : "text-ink"}`}
                  >
                    {rupees(scenario.profit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate">Return on spend</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {scenario.roi != null ? (
                      `${scenario.roi.toFixed(0)}%`
                    ) : (
                      <span className="text-slate">Not defined at zero spend</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="mt-3 text-sm text-clay">Enter numbers only.</p>
          )}

          {edited ? (
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => {
                setPriceInput("");
                setCostInput("");
                setYieldPercent("100");
              }}
            >
              <RotateCcw aria-hidden className="size-4" />
              Back to the engine's estimate
            </Button>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
