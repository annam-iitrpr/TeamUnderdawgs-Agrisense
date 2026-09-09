import { expect, test, type Page } from "@playwright/test";

/**
 * Acceptance tests for the desktop/PWA directive relayed in Phase 3's
 * interface requests:
 *
 *   "no horizontal overflow at 360/768/1280/1920px; installable manifest;
 *    authenticated content is never cached offline"
 *
 * These run unauthenticated against public routes, so they need no backend and
 * no Firebase account. They are therefore honest `contract-fixture`-profile
 * evidence about layout and PWA wiring — NOT integration evidence.
 */

/** The four widths the directive names. */
const BREAKPOINTS = [
  { name: "mobile-360", width: 360, height: 780 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1920", width: 1920, height: 1080 },
] as const;

/** Public routes. `/` redirects to `/sign-in` when signed out. */
const ROUTES = ["/sign-in", "/sign-up", "/reset-password"] as const;

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // A 1px rounding difference is not a layout bug; anything more is.
    const overflowBy = doc.scrollWidth - doc.clientWidth;
    // Also find the widest offender, so a failure is actionable rather than
    // just "something overflows".
    let worst = { selector: "", right: 0 };
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > worst.right) {
        worst = {
          selector: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(/\s+/)[0]}` : ""}`,
          right: Math.round(rect.right),
        };
      }
    }
    return { overflowBy, clientWidth: doc.clientWidth, worst };
  });
}

for (const bp of BREAKPOINTS) {
  test.describe(`${bp.name} (${bp.width}px)`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    for (const route of ROUTES) {
      test(`${route} does not scroll horizontally`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("networkidle");

        const { overflowBy, clientWidth, worst } = await horizontalOverflow(page);
        expect(
          overflowBy,
          `${route} at ${bp.width}px overflows by ${overflowBy}px (client ${clientWidth}px). ` +
            `Widest element: ${worst.selector} ending at ${worst.right}px.`,
        ).toBeLessThanOrEqual(1);
      });
    }

    test("primary action stays reachable without horizontal scrolling", async ({ page }) => {
      await page.goto("/sign-in");
      const submit = page.getByRole("button", { name: /sign in/i });
      await expect(submit).toBeVisible();

      const box = await submit.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(bp.width + 1);
        // The spec's 44-48px touch target floor.
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}

test.describe("installable manifest", () => {
  test("is linked and serves a valid manifest with both required icon sizes", async ({
    page,
    request,
  }) => {
    await page.goto("/sign-in");

    const href = await page.getAttribute('link[rel="manifest"]', "href");
    expect(href, "no <link rel=manifest> in the document head").toBeTruthy();

    const response = await request.get(href!);
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    // Chrome will not offer installation without these.
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");

    const sizes: string[] = (manifest.icons ?? []).map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");

    // A maskable icon keeps the mark from being clipped by an aggressive mask.
    const purposes: string[] = (manifest.icons ?? []).map((i: { purpose?: string }) => i.purpose ?? "any");
    expect(purposes).toContain("maskable");
  });

  test("every declared icon actually resolves", async ({ page, request }) => {
    await page.goto("/sign-in");
    const href = await page.getAttribute('link[rel="manifest"]', "href");
    const manifest = await (await request.get(href!)).json();

    for (const icon of manifest.icons as Array<{ src: string; type: string }>) {
      const res = await request.get(icon.src);
      expect(res.status(), `${icon.src} is declared but does not resolve`).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
  });
});

test.describe("service worker caching policy", () => {
  test("the offline fallback page is public and holds no farm data", async ({ request }) => {
    const res = await request.get("/offline.html");
    expect(res.status()).toBe(200);
    const html = await res.text();
    // It is precached, so it must never contain anything user-specific.
    expect(html).not.toMatch(/Bearer|idToken|@example|field_|season_/i);
  });

  test("the worker never caches the API or Next data payloads", async ({ request }) => {
    // Read the shipped worker and assert the policy is present in the file
    // itself. A behavioural test would need a signed-in session plus offline
    // emulation; this at minimum stops the exclusions being deleted silently.
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    const source = await res.text();

    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain('url.pathname.startsWith("/_next/data/")');
    // Non-GET must be passed through untouched.
    expect(source).toContain('request.method !== "GET"');
    // Navigation responses must not be written to the cache. If a future edit
    // adds cache.put for a navigation, this catches it.
    expect(source).not.toMatch(/cache\.put\(\s*request/);
  });
});
