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
 *
 * The prices arrive as a prop rather than from `useMarketPrices` here. The crop
 * card now leads with the per-quintal price, so the card holds the hook and
 * both the headline and this panel read the same answer. Calling the hook in
 * both places would put two requests per card on the wire for one crop, and
 * would let the headline and the detail below it disagree for a moment.
 */
import { Callout, Card, Skeleton, UnknownValue } from "@/components/ui";
import type { Measurement } from "@/lib/api/contract";
import { formatMoney } from "@/lib/format";
import { explainCode } from "@/lib/missing-reasons";
import type { MarketPricesState } from "./use-market-prices";
import { IndianRupee, MapPin } from "lucide-react";

/** The unit the whole mandi feed speaks. A price in anything else is a different claim. */
const PER_QUINTAL = "INR/quintal";

function rupees(value: number): string {
  return formatMoney(value);
}

/**
 * A price as a farmer would say it: "₹2,425/quintal".
 *
 * Returns null rather than a number when the measurement is absent or arrives
 * in some other unit. Relabelling a per-kilogram figure as per-quintal would be
 * wrong by a factor of a hundred, which is the kind of error a farmer would
 * only find out about at the mandi gate.
 */
export function rupeesPerQuintal(measurement: Measurement | null | undefined): string | null {
  const value = measurement?.value;
  if (value == null || !Number.isFinite(value)) return null;
  if (measurement?.unit !== PER_QUINTAL) return null;
  return `${rupees(value)}/quintal`;
}

function reportedOn(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function MarketPricePanel({
  cropName,
  market,
  harvestFrom,
}: {
  cropName: string;
  /** The one market answer for this crop, fetched once by the card above. */
  market: MarketPricesState;
  /** The farmer's own harvest window, when the planner has worked one out. */
  harvestFrom?: string | null;
}) {
  const { prices, loading, unavailable } = market;

  if (loading) return <Skeleton className="h-28 w-full rounded-card" />;

  if (unavailable || !prices) {
    return (
      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <IndianRupee aria-hidden className="size-4 text-forest" />
          Mandi price
        </p>
        <div className="mt-1">
          <UnknownValue label={explainCode("no_mandi_reported_this_crop_today")} />
        </div>
      </Card>
    );
  }

  const low = rupeesPerQuintal(prices.low);
  const high = rupeesPerQuintal(prices.high);
  const modal = rupeesPerQuintal(prices.modal);
  const msp = rupeesPerQuintal(prices.msp);
  const nearest = prices.nearest;
  const nearestModal = rupeesPerQuintal(nearest?.modal);
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

      {low && high ? (
        <>
          <p translate="no" className="mt-1 text-h3 font-semibold tabular-nums text-ink">
            {low} – {high}
          </p>
          <p className="mt-0.5 text-xs text-slate">
            {/* A reference price is not reported by any mandi, so counting them
                said "Across 0 mandis" -- which reads as a failure rather than as
                the deliberate fallback it is. It names itself instead. */}
            {quotes.length > 0
              ? `Across ${quotes.length} mandi${quotes.length === 1 ? "" : "s"}`
              : "Indicative reference price for this season"}
            {quotes.length > 0 && reported ? ` reporting on ${reportedOn(reported)}` : ""}
            {modal ? (
              <>
                {". Most common price "}
                <span translate="no">{modal}</span>.
              </>
            ) : (
              "."
            )}
          </p>
        </>
      ) : (
        <div className="mt-1">
          <UnknownValue label={explainCode("no_mandi_reported_this_crop_today")} />
        </div>
      )}

      {nearest && nearestModal ? (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-ink">
          <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0 text-forest" />
          <span>
            Nearest reporting mandi is <span className="font-semibold">{nearest.market}</span>,{" "}
            {nearest.district} at <span translate="no">{nearestModal}</span>
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

      {/* The support price is the floor the mandi range is judged against, so it
          belongs beside the range and not only in its absence. When it is
          absent the reason matters more than the gap: a crop with no declared
          MSP and a crop whose published list has gone stale are different
          situations, and only one of them means "there is no floor". */}
      {msp ? (
        <p className="mt-2 text-xs text-slate">
          Government support price <span translate="no">{msp}</span>. A mandi offer below that
          is worth questioning.
        </p>
      ) : (
        <Callout tone="info" className="mt-3 text-xs">
          {explainCode(prices.msp_missing_reason ?? "current_declared_msp_series_unavailable")}.
        </Callout>
      )}
    </Card>
  );
}
