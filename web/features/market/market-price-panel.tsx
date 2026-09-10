"use client";

/**
 * What this crop is fetching at mandis, and what that means at harvest.
 *
 * Three decisions worth stating, because each rejects a more impressive
 * version of this panel:
 *
 * 1. **A range, not a price.** Prices differ by mandi, variety and grade on the
 *    same day. Showing one number would hide the variation the farmer is
 *    actually exposed to, and it is the low end that decides whether a season
 *    pays.
 * 2. **No revenue figure.** "What you will get at harvest" needs a yield, and
 *    no reviewed yield data exists for these crops. Price times a yield we do
 *    not have would be a confident invention, so this shows the price and the
 *    farmer's own harvest window and stops there.
 * 3. **Today's price, labelled as today's.** These are reported arrivals, not a
 *    forecast. A price at harvest is months away and nobody here can predict
 *    it, so the date is always on screen.
 */
import { Callout, Card, Skeleton, UnknownValue } from "@/components/ui";
import { useMarketPrices } from "./use-market-prices";
import { IndianRupee, MapPin } from "lucide-react";

function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function reportedOn(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function MarketPricePanel({
  cropId,
  cropName,
  state,
  harvestFrom,
}: {
  cropId: string;
  cropName: string;
  /** Narrows "near you" to a market the farmer could actually reach. */
  state?: string | null;
  /** The farmer's own harvest window, when the planner has worked one out. */
  harvestFrom?: string | null;
}) {
  const { prices, loading, unavailable } = useMarketPrices(cropId, state);

  if (loading) return <Skeleton className="h-28 w-full rounded-card" />;

  if (unavailable || !prices) {
    return (
      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <IndianRupee aria-hidden className="size-4 text-forest" />
          Mandi price
        </p>
        <div className="mt-1">
          <UnknownValue
            label="Not known"
            reason="no market reported a usable price for this crop today"
          />
        </div>
      </Card>
    );
  }

  const low = prices.low.value;
  const high = prices.high.value;
  const modal = prices.modal.value;
  const nearest = prices.nearest;
  // Optional on the contract: a bundle with no quotes is possible in principle
  // and must not throw here.
  const quotes = prices.quotes ?? [];
  const warnings = prices.warnings ?? [];
  const reported = quotes[0]?.reported_on;

  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <IndianRupee aria-hidden className="size-4 text-forest" />
        What {cropName.toLowerCase()} is fetching now
      </p>

      {low != null && high != null ? (
        <>
          <p className="mt-1 text-h3 font-semibold text-ink">
            {rupees(low)} – {rupees(high)}
            <span className="ml-1 text-sm font-normal text-slate">per quintal</span>
          </p>
          <p className="mt-0.5 text-xs text-slate">
            {/* A reference price is not reported by any mandi, so counting them
                said "Across 0 mandis" -- which reads as a failure rather than as
                the deliberate fallback it is. It names itself instead. */}
            {quotes.length > 0
              ? `Across ${quotes.length} mandi${quotes.length === 1 ? "" : "s"}`
              : "Indicative reference price for this season"}
            {quotes.length > 0 && reported ? ` reporting on ${reportedOn(reported)}` : ""}
            {modal != null ? `. Most common price ${rupees(modal)}.` : "."}
          </p>
        </>
      ) : (
        <div className="mt-1">
          <UnknownValue label="Not known" />
        </div>
      )}

      {nearest && nearest.modal.value != null ? (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-ink">
          <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0 text-forest" />
          <span>
            Nearest reporting mandi is <span className="font-semibold">{nearest.market}</span>,{" "}
            {nearest.district} at {rupees(nearest.modal.value)}
            {nearest.variety ? ` for ${nearest.variety}` : ""}.
          </span>
        </p>
      ) : warnings.includes("no_market_in_your_state_reported_today") ? (
        <p className="mt-2 text-xs text-slate">
          No mandi in your state reported today, so the range above is from elsewhere in India.
        </p>
      ) : null}

      {/* The farmer's own harvest window, with no revenue attached. Multiplying
          a price by a yield we do not have would be the invented part. */}
      {harvestFrom ? (
        <p className="mt-2 text-xs text-slate">
          You would be selling from around {reportedOn(harvestFrom)}. This is today&rsquo;s price,
          not a prediction of the price then.
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate">
          Today&rsquo;s reported prices, not a forecast.
        </p>
      )}

      {prices.msp == null ? (
        <Callout tone="info" className="mt-3 text-xs">
          The government&rsquo;s minimum support price is not shown: the only published series
          available ends at 2022-23, and quoting a four-year-old figure in a sale could lose you
          money.
        </Callout>
      ) : null}
    </Card>
  );
}
