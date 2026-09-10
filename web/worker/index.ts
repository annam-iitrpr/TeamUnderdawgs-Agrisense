/**
 * The Cloudflare Worker that serves the static site, plus one narrow proxy.
 *
 * The site is static and holds no secrets. The single exception is
 * `/edge/market-prices`, which exists for an infrastructure reason rather than
 * an architectural preference:
 *
 * data.gov.in drops connections from Cloud Run's egress with
 * `RemoteProtocolError` — the same request with identical headers succeeds from
 * an ordinary network, so it is the source address being refused, not anything
 * about the request. The mandi price route on the API therefore cannot reach
 * its upstream in production, and degrades to an honest 503.
 *
 * Proxying from here fixes it without weakening anything: the request leaves
 * Cloudflare's network instead of Google's, and the API key stays a Worker
 * secret rather than shipping in the browser bundle, which is where it would
 * have to live if the page called data.gov.in directly.
 *
 * The API route is kept as the primary path. This is a fallback the client
 * reaches for only when that route reports its dependency unavailable, so if
 * the egress block is ever lifted the proxy simply stops being used.
 */

interface Env {
  ASSETS: Fetcher;
  /** data.gov.in key. A Worker secret; never exposed to the page. */
  DATA_GOV_IN_API_KEY?: string;
}

const RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070";
const UPSTREAM = `https://api.data.gov.in/resource/${RESOURCE}`;

/** Our crop ids to the commodity names this feed publishes. */
const COMMODITY: Record<string, string> = {
  cotton: "Cotton",
  wheat: "Wheat",
  rice: "Paddy",
  maize: "Maize",
  soybean: "Soyabean",
  potato: "Potato",
  barley: "Barley",
  field_pea: "Peas(Dry)",
  lentil: "Lentil (Masur)(Whole)",
  sorghum: "Jowar(Sorghum)",
  bajra: "Bajra(Pearl Millet/Cumbu)",
  groundnut: "Groundnut",
  onion: "Onion",
  tomato: "Tomato",
  moong: "Green Gram (Moong)(Whole)",
  // Sugarcane is absent on purpose: it is not traded in APMC daily arrivals,
  // so the API serves it the State Advised Price instead of a mandi quote.
};

const MAX_RECORDS = "200";
/** Long enough that a burst of farmers costs one upstream call. */
const CACHE_SECONDS = 1800;

function json(body: unknown, status = 200, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
    },
  });
}

async function marketPrices(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const crop = (url.searchParams.get("crop") ?? "").toLowerCase();
  const commodity = COMMODITY[crop];
  if (!commodity) {
    return json({ error: { code: "CROP_NOT_PRICED", message: "No price series for this crop." } }, 404);
  }
  if (!env.DATA_GOV_IN_API_KEY) {
    return json(
      { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Market prices are not configured." } },
      503,
    );
  }

  const upstream = new URL(UPSTREAM);
  upstream.searchParams.set("api-key", env.DATA_GOV_IN_API_KEY);
  upstream.searchParams.set("format", "json");
  upstream.searchParams.set("limit", MAX_RECORDS);
  upstream.searchParams.set("filters[commodity]", commodity);

  // Cached at the edge by URL, which deliberately excludes the key: the cache
  // key is built from the public request, so one farmer's fetch serves the next.
  const cacheKey = new Request(`https://cache.agrisense/market/${commodity}`, { method: "GET" });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let payload: unknown;
  try {
    const response = await fetch(upstream.toString(), {
      headers: {
        accept: "application/json",
        // Not cosmetic: this upstream blackholes `Python-urllib` agents, and an
        // unnamed client is the kind of thing a WAF treats the same way.
        "user-agent": "AgriSense/1.0 (+https://agrisense.spacesdrive.cc)",
      },
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    payload = await response.json();
  } catch {
    return json(
      { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Market prices are unavailable right now." } },
      503,
    );
  }

  const body = payload as { status?: string; records?: unknown[] };
  if (body?.status !== "ok" || !Array.isArray(body.records)) {
    return json(
      { error: { code: "DEPENDENCY_UNAVAILABLE", message: "The market price service rejected the request." } },
      503,
    );
  }

  // Only the fields the page needs, so the proxy cannot become a general
  // pass-through for a dataset with columns we have not looked at.
  const records = body.records
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      market: String(row.market ?? ""),
      district: String(row.district ?? ""),
      state: String(row.state ?? ""),
      variety: row.variety ? String(row.variety) : null,
      grade: row.grade ? String(row.grade) : null,
      min_price: String(row.min_price ?? ""),
      max_price: String(row.max_price ?? ""),
      modal_price: String(row.modal_price ?? ""),
      arrival_date: String(row.arrival_date ?? ""),
    }));

  const result = json({ commodity, records }, 200, CACHE_SECONDS);
  await cache.put(cacheKey, result.clone());
  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/edge/market-prices") {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
      return marketPrices(request, env);
    }
    // Everything else is the static site.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
