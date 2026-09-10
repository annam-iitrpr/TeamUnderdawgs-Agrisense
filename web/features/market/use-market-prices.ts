"use client";

/**
 * Live mandi prices, from whichever path can actually reach them.
 *
 * The API route is the primary source and is tried first. It cannot currently
 * succeed in production: data.gov.in refuses connections from Cloud Run's
 * egress, so the route answers an honest 503. The edge proxy on the Cloudflare
 * Worker serving this site leaves a different network and does reach it.
 *
 * The order matters. The API is asked first so that the day the egress block is
 * lifted the proxy quietly stops being used, with no code change. The fallback
 * fires only on a dependency failure — never on a 404 for an unpriced crop,
 * which is a real answer the proxy cannot improve on.
 */
import { useAuth } from "@/features/auth/auth-provider";
import type { MarketPrices, MarketQuote } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { market as marketApi } from "@/lib/api/routes";
import { useCallback, useEffect, useRef, useState } from "react";

/** What the edge proxy returns: the upstream's own rows, narrowed. */
type EdgeRow = {
  market: string;
  district: string;
  state: string;
  variety: string | null;
  grade: string | null;
  min_price: string;
  max_price: string;
  modal_price: string;
  arrival_date: string;
};

const UNIT = "INR/quintal";

/** A price, or null: this feed uses both blanks and zeroes for "no trade". */
function price(raw: string): number | null {
  const value = Number(String(raw).trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isoDate(raw: string): string | null {
  const text = String(raw).trim();
  const parts = text.split("/");
  if (parts.length !== 3) return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  const [day, month, year] = parts;
  return `${year}-${month}-${day}`;
}

/**
 * Builds the shape the API route returns, so callers never branch on which path
 * answered. Unusable rows are dropped rather than allowed to widen the range in
 * the wrong direction.
 */
function fromEdge(
  cropId: string,
  commodity: string,
  rows: EdgeRow[],
  state: string | null,
): MarketPrices | null {
  const quotes: MarketQuote[] = [];
  for (const row of rows) {
    const low = price(row.min_price);
    const high = price(row.max_price);
    const mid = price(row.modal_price);
    const reported = isoDate(row.arrival_date);
    if (low == null || high == null || mid == null || reported == null || high < low) continue;
    quotes.push({
      market: row.market || "unnamed market",
      district: row.district,
      state: row.state,
      variety: row.variety,
      grade: row.grade,
      minimum: { value: low, unit: UNIT },
      maximum: { value: high, unit: UNIT },
      modal: { value: mid, unit: UNIT },
      reported_on: reported,
    });
  }
  if (quotes.length === 0) return null;

  // Lowest minimum to highest maximum: the range a farmer could actually meet,
  // not the narrower spread of modal prices.
  const lows = quotes.map((q) => q.minimum.value ?? 0);
  const highs = quotes.map((q) => q.maximum.value ?? 0);
  const modals = quotes.map((q) => q.modal.value ?? 0).sort((a, b) => a - b);

  const local = state
    ? quotes.filter((q) => q.state.toLowerCase() === state.toLowerCase())
    : [];
  local.sort((a, b) => (a.modal.value ?? 0) - (b.modal.value ?? 0));

  return {
    crop_id: cropId,
    commodity,
    quotes,
    low: { value: Math.min(...lows), unit: UNIT },
    high: { value: Math.max(...highs), unit: UNIT },
    modal: { value: modals[Math.floor(modals.length / 2)] ?? 0, unit: UNIT },
    nearest: local[Math.floor(local.length / 2)] ?? null,
    // Deliberately absent: the only machine-readable declared-MSP series ends
    // at 2022-23, and a stale figure quoted in a sale would cost a farmer money.
    msp: null,
    msp_missing_reason: "current_declared_msp_series_unavailable",
    retrieved_at: new Date().toISOString(),
    source: "data.gov.in:agmarknet_daily_prices",
    data_mode: "live",
    warnings: [
      "prices_are_reported_arrivals_not_a_forecast",
      `reported_by_${quotes.length}_markets`,
      ...(state && local.length === 0 ? ["no_market_in_your_state_reported_today"] : []),
    ],
  };
}

async function viaEdge(cropId: string, state: string | null): Promise<MarketPrices | null> {
  const response = await fetch(`/edge/market-prices?crop=${encodeURIComponent(cropId)}`);
  if (!response.ok) return null;
  const body = (await response.json()) as { commodity?: string; records?: EdgeRow[] };
  if (!body.commodity || !Array.isArray(body.records)) return null;
  return fromEdge(cropId, body.commodity, body.records, state);
}

export type MarketPricesState = {
  prices: MarketPrices | null;
  loading: boolean;
  /** Set only when neither path could answer. */
  unavailable: boolean;
};

export function useMarketPrices(cropId: string | null, state?: string | null): MarketPricesState {
  const { user } = useAuth();
  const [prices, setPrices] = useState<MarketPrices | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // Guards a slow answer for one crop overwriting a newer one for another.
  const latest = useRef(0);
  const signedIn = Boolean(user);

  const load = useCallback(async () => {
    if (!cropId || !signedIn) return;
    const ticket = ++latest.current;
    setLoading(true);
    setUnavailable(false);
    try {
      const { data } = await marketApi.prices(cropId, state ?? undefined);
      if (ticket === latest.current) setPrices(data);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        if (ticket === latest.current) setUnavailable(true);
        return;
      }
      try {
        const fallback = await viaEdge(cropId, state ?? null);
        if (ticket !== latest.current) return;
        if (fallback) setPrices(fallback);
        else setUnavailable(true);
      } catch {
        if (ticket === latest.current) setUnavailable(true);
      }
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [cropId, state, signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  return { prices, loading, unavailable };
}
