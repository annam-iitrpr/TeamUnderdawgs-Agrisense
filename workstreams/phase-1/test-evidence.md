# Phase 1 test evidence

Text index of what was actually run and what was observed. Screenshots and traces
live under `web/test-results/` and `web/playwright-report/`, both git-ignored.

Rules for this file:

- A command is only listed with its real exit code and real output summary.
- A test skipped for a missing credential is recorded as an **external blocker**,
  never as evidence that the path works.
- A `contract-fixture` pass is never recorded as integration evidence.

## Slice 0 — repository and workstream scaffolding

| Check | Command | Result |
|---|---|---|
| Remote state | `git ls-remote origin` | zero refs (empty repository) — recorded as blocker |
| Dependency version probe | `npm view <pkg> version` | firebase 12.19.0, zod 4.6.0, next 16.3.4, react 19.3.0, tailwindcss 4.3.3 |

No application checks were runnable in this slice: dependencies were not yet
installed.

## Slice 1 — design tokens, base styles and shared formatters

| Check | Command | Result |
|---|---|---|
| Dependency install | `npm install --no-audit --no-fund` | exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0, no diagnostics |
| Unit tests | `npx vitest run` | exit 0 — 26 passed / 26 total, 1 file |

Unit coverage landed in this slice (`web/tests/unit/format.test.ts`), chosen
because the UTC-to-IST conversion is where a silent off-by-one-day defect would
put a spray window on the wrong morning:

- IST calendar date is preserved for an instant that falls on the previous day
  in UTC (`2026-07-24T19:30:00Z` → `2026-07-25`), and the rollover happens at
  18:30Z rather than 00:00Z.
- `daysFromToday` counts IST calendar days, so 01:00 IST tomorrow is 1 rather
  than 0.
- Unknown renders as an explicit marker, never as `0`, `₹0` or `0%`, across
  area, money, litres, percent and both range bounds.
- A negative margin stays negative and is not clamped to a positive value.
- Acre/hectare conversion round-trips and matches the standard factor.

Not yet evidenced: no browser run, no screenshots, no integration. There is no
backend to integrate against (progress.md blocker 3).

## Slice 2 — five-language i18n with completeness gate

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no diagnostics |
| Unit tests | `npx vitest run` | exit 0 — 43 passed / 43 total, 2 files |

Added `web/tests/unit/i18n.test.ts` (17 tests). What it actually enforces:

- All five spec languages ship (`en`, `hi`, `mr`, `pa`, `te`), each with a
  native-script name for the switcher.
- **Completeness gate**: a per-language assertion fails and names the missing
  keys if English gains a key the other four dictionaries do not have. This is
  the spec's "track untranslated keys and fail completeness checks" — it is the
  check that stops English text appearing inside a Telugu screen.
- A whitespace-only value counts as missing, so the gate cannot be satisfied
  with blank labels.
- `REVIEW_STATUS` asserts English is the source and every other language is
  `pending-review`. This test is intentionally a tripwire: flipping any
  language to `reviewed` fails until a named reviewer is recorded in
  decisions.md.
- `interpolate` leaves an unmatched placeholder visible rather than printing
  `undefined`, and substitutes a literal `0` instead of treating it as absent.

**External blocker (unchanged):** no native-speaker or agronomist review has
happened for Hindi, Marathi, Punjabi or Telugu. Punjabi and Telugu are newly
written for this phase and have had no review at all. Per the spec this is
recorded as pending, not presented as a finished multilingual product.

## Slice 3 — provisional v1 API client, contract types and query discipline

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no diagnostics |
| Unit tests | `npx vitest run` | exit 0 — 57 passed / 57 total, 3 files |

Added `web/tests/unit/api-envelope.test.ts` (14 tests):

- Every status the contract assigns to a condition maps to the right error code
  (401/403/404/409/422/429/503), with an explicit unknown fallback.
- Retryability is correct per condition: rate-limit, dependency-unavailable and
  network invite a retry; unauthenticated, forbidden, invalid-input, not-found
  and version-conflict do not, so the UI never offers a button that cannot help.
- `fieldErrors` extracts per-input messages from a 422 only, and returns nothing
  for other codes or non-errors.
- **Query-key isolation**, which is the P1-04 cross-contamination requirement:
  keys differ by field, by actor for the same field id, and by input version.
  Absent members are dropped so a missing season cannot collide with a literal.

`useApiQuery` additionally aborts the in-flight request on key change **and**
discards a late result whose key is no longer current, because an abort is not
guaranteed to win the race. That behaviour is asserted in the browser rather
than here; the Playwright case for rapid field switching is listed as pending
in progress.md and is not claimed as evidence yet.

**Not evidenced:** the client has never spoken to a real server. There is no
backend (progress.md blocker 3). The envelope shape is provisional per IR-003 —
if Phase 3's actual envelope differs, these tests pass while the integration
would fail, which is exactly why IR-003 asks for confirmation.

## Slice 4 — P1-01 authentication screens (partial)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npx next lint` | exit 0 — "No ESLint warnings or errors" |
| Production build | `npx next build` | exit 0 after a real fix (below); 5 routes prerendered |
| Unit tests | `npx vitest run` | exit 0 — 62 passed / 62 total, 4 files |
| Browser | dev server on `:3000`, Chrome | `/sign-in`, `/sign-up` inspected; no console errors, no hydration warnings |

### Defects found and fixed in this slice

1. **Build failure.** `useSearchParams()` in `/sign-in` opted the route out of
   static prerendering and `npx next build` failed outright. Fixed by isolating
   the `?reason=expired` read into a child component behind a `<Suspense>`
   boundary. Caught only because the production build was actually run — the
   dev server did not complain.
2. **Mixed-language validation errors.** Submitting the empty form and then
   switching language left the two field errors in English under Telugu labels.
   Cause: the resolved *string* was stored in React state at submit time.
   Fixed by storing translation *keys* and resolving them at render, across
   sign-in, sign-up and reset-password. Verified in the browser: errors now
   read "మీ ఇమెయిల్ చిరునామా ఇవ్వండి." in Telugu.
3. **Password toggle overlap.** The toggle was absolutely positioned over the
   input with a fixed `pr-[5.5rem]` reservation. The Telugu label
   ("పాస్‌వర్డ్ చూపించు") is materially wider than "Show password", so typed
   text could run underneath it. Fixed by giving the toggle its own flex cell
   inside the bordered wrapper, with focus-within styling preserved.

### Verified in the browser

- All five languages render in native script in the switcher, including
  Gurmukhi and Telugu — no tofu boxes with the Noto fallbacks added.
- Selecting Telugu translates the whole screen, and the choice survives a full
  page reload (localStorage), with `<html lang>` updated.
- Empty-form submission marks both fields invalid, shows an icon **and** text
  for each error, and moves focus to the first invalid input.
- The emulator banner is visible whenever the emulator URL is configured, so
  local test accounts cannot be mistaken for real ones.

### External blocker — the mandatory dev-account test is NOT done

The spec requires every device to create a test farmer through the real
email/password sign-up screen against the Firebase Auth Emulator, sign out,
sign back in, and refresh. **That has not been performed.** Neither `java` nor
`firebase-tools` is installed on this machine, so the Auth Emulator cannot
start:

```
$ java -version   → command not found
$ firebase --version → could not determine executable to run
```

Consequently **no sign-in, sign-up, session-persistence, token-refresh or
cross-account denial path has been exercised against a real identity
provider.** What is verified is rendering, validation, focus management,
localisation and the production build. Per the spec, a check skipped for a
missing prerequisite is an external blocker and not evidence that the
integration works, so P1-01 stays `in-progress`, not `verified`.

Unblocking needs either a JDK plus `firebase-tools` locally, or the team's real
Firebase web config for a staging test account.

## Slice 5 — merge of the `contract_v1` bootstrap

| Check | Command | Result |
|---|---|---|
| Ancestry before merge | `git merge-base HEAD origin/codex/phase-3-platform` | **no common ancestor** — the problem this slice fixes |
| Merge | `git merge contract_v1 --allow-unrelated-histories --no-ff` | 12 conflicts, all resolved by ownership (D-006) |
| Typecheck | `npx tsc --noEmit` | exit 0 after fixing 2 real defects (below) |
| Lint | `npx next lint` | exit 0 — "No ESLint warnings or errors" |
| Production build | `npx next build` | exit 0 — 15 routes, mine and the bootstrap's together |
| Unit tests | `npx vitest run` | exit 0 — 62 passed / 62 total |
| Browser, my screens | `/sign-in` | renders; Telugu persisted across the merge; password toggle in its own cell |
| Browser, bootstrap screens | `/field/1` | renders inside `PhoneFrame` with the honest "cannot reach the service" state; no context crash, no console errors |

### Defects the merge surfaced and fixed

Keeping this branch's stricter `tsconfig` (`noUncheckedIndexedAccess`) made the
compiler reject two lines in the bootstrap's own chart screens
(`app/field/[id]/why` and `app/dashboard/fields/[id]`). They were not cosmetic:

```ts
for (const s of SERIES) row[s] = d.scores[s];   // number | null | undefined
```

`d.scores` is a `Record<string, number | null>`, so a stress type absent from
the record yields `undefined`. Feeding that into the chart row let a **missing**
series render as a **zero** — precisely the "unknown must not read as no risk"
error the spec calls out repeatedly. Both sites now coerce to `null`.

Also cleared eight pre-existing unused-import lint warnings in the bootstrap's
screens, so `next lint` is clean and a real warning will be visible in CI.

## Slice 6 — P1-01 auth round trip verified against real Firebase

The slice-4 blocker is **closed**. The Auth Emulator still cannot run here (no
`java`, no `firebase-tools`), but `agrisense.env` carries the team's real
Firebase **web** config — which is public client identification, not a secret —
so `web/.env.local` was pointed at the live project (`iitm02`) with the emulator
URL deliberately absent. The spec's fallback for exactly this case is a
dedicated real test account, which is what was used.

Test account: `device1.phase1@example.test`. The domain is reserved and
undeliverable on purpose, so the verification mail cannot reach a real person.
Credentials live only in the ignored local env; the account can be deleted from
the Firebase console when no longer needed.

| Step | Observed |
|---|---|
| Account creation through the real sign-up screen | Created on the live project; redirected to `/` |
| Verification email | Sent — the "Confirm your email address" banner appears with a working resend action |
| Sign out | Session cleared, redirected to `/sign-in` |
| **Wrong password** | Rejected with "That email address and password do not match." — the deliberately non-enumerating message, so an unknown address and a wrong password are indistinguishable |
| Sign in with correct password | Succeeded, landed on `/` with the account's email shown |
| **Full page reload** | Session persisted; still signed in, no flash back to `/sign-in` |
| Console | No errors, no exceptions, no hydration warnings across the whole sequence |

This covers the spec's mandatory dev-account discipline: sign up through the
real screen, sign out, sign back in through the same screen, refresh.

**Still not covered, and not claimed:** no API call has been made with the
issued ID token (the backend was not running during this slice), cross-account
denial needs a second tenant account, and token-expiry/revocation recovery is
untested. Those move to the live-local integration slice.

### What the merge did NOT verify

- The bootstrap's backend was not run. `/field/1` reaching its error state
  proves the provider wiring and the error path, not integration.
- The generated types at `web/lib/generated/api.ts` are present but unused;
  nothing here proves this branch's request shapes match them.
- The authentication blocker from slice 4 is unchanged.

## Slice 7 — retired the provisional API types for the generated contract

Phase 3 asked for this directly in its interface requests, and the reason is
sound: two independent definitions of the same shapes will drift.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npx next lint` | exit 0, clean |
| Unit tests | `npx vitest run` | exit 0 — 74 passed / 74 total, 5 files |
| Drift guard, negative test | inserted a bogus path, ran `tsc` | **failed as intended**: `Type '"/api/v1/this-route-does-not-exist"' is not assignable to type 'keyof paths'`; clean again after reverting |

`web/lib/api/types.ts` is deleted. `contract.ts` now aliases the generated
schemas, `envelope.ts` derives `Meta`/`Provenance`/`ErrorDetail` from them, and
`routes.ts` provides typed calls for the 27 routes Phase 1 consumes.

**The provisional guesses were wrong in ways that would have broken at runtime**,
which is the concrete argument for having done this before building screens:

| Field | Guessed | Actual contract |
|---|---|---|
| `entered_area_unit` | `ha \| acre` | `ha \| acre \| sqm \| kanal` |
| Water availability | `available_water_litres` | `available_water_m3` |
| `date_confidence` | `exact \| approximate \| unknown` | `confirmed \| estimated \| unknown` |
| `stage_source` | `farmer_confirmed \| agronomist \| gdd_estimate \| unknown` | `farmer \| observed \| model \| unknown` |
| Soil values | flat numbers | `Measurement` objects with unit, analyte, method and `missing_reason` |
| Field location | loose lat/lon fields | a `Location` object with `source: gps \| map \| manual \| village` |

What was guessed correctly: the `{data, meta}` envelope, the
`{error, request_id}` error body, and the five-language enum — so IR-003 was
answered in the affirmative on the parts the screens depend on most.

The contract's prose-only rules are now enforced in code and covered by tests:
idempotency keys stay inside 8–128 characters, list limits clamp to 1–100, a
null cursor is omitted rather than serialised, and absent metadata still
defaults to `data_mode: unavailable` rather than `live`.

**Not verified:** no call has been made against the running API. Route paths and
payload types are checked against the generated contract, which is a compile-time
guarantee, not an integration one.

## Slice 8 — responsive shell and installable PWA

Implements the user directive relayed through Phase 3's interface requests:
*"Build a full-width desktop experience with responsive tablet/mobile layouts
and installable PWA support. The inherited phone-frame layout is not acceptable
as the desktop website."*

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npx next lint` | exit 0, clean |
| Unit tests | `npx vitest run` | exit 0 — 74/74 |
| Production build | `npx next build` | exit 0 — 19 routes incl. `/manifest.webmanifest` |
| **Playwright (first E2E suite)** | `npx playwright test --project=desktop` | **20 passed** |
| Negative test, overflow | injected a 3000px element into `/reset-password` | **failed at all four breakpoints as intended**, then green again on revert |
| Icon dimensions | `magick identify` | 192, 512, maskable 192, maskable 512, apple 180 — all sRGB PNG |
| Assets over HTTP | `curl` against `next start` | `/manifest.webmanifest`, `/sw.js`, `/offline.html` and every icon return 200 with correct content types |

### Acceptance criteria, each actually asserted

- **No horizontal overflow at 360 / 768 / 1280 / 1920px** on `/sign-in`,
  `/sign-up` and `/reset-password`. The assertion measures
  `scrollWidth - clientWidth` and, on failure, names the widest offending
  element and where it ends — so a regression is actionable rather than just
  "something overflows".
- **Primary action reachable** at every breakpoint, fully inside the viewport,
  with height ≥ 44px (the spec's touch-target floor).
- **Installable manifest**: linked in the head, `display: standalone`, both 192
  and 512 icons present, at least one `maskable`, and every declared icon
  resolves as `image/png`.
- **Authenticated content is never cached offline.** Asserted against the
  shipped worker: `/api/` and `/_next/data/` are excluded, non-GET is passed
  through untouched, and there is no `cache.put(request…)` for a navigation.
  The precached offline page is checked to contain no token, email or record id.

### Why the service worker is written this way

It precaches only the offline page and the icons. Navigation responses are
fetched from the network and **never** written to the cache, because an
authenticated HTML document would land there. There is no runtime caching of API
data at all — beyond the privacy rule, a cached spray recommendation is
actively harmful, since the window it names may already have passed. Sign-out
also posts a purge message to the worker as a second line of defence.

### Layout

`components/app-shell.tsx` replaces `PhoneFrame` for new screens: bottom
navigation below 1024px, a persistent sidebar at and above it, content capped at
100rem and centred so wide monitors gain columns rather than 1900px-long text
lines. `min-w-0` on the flex child is what actually stops a wide chart or table
pushing the page sideways.

`/plan`, `/journal` and `/ask` are routed to an honest "not built yet" screen
naming the requirement and the endpoints each is waiting on, because the shell's
navigation must not lead to a 404 and must not show invented figures.

**Not verified:** installation was not performed on a real device, iOS Safari
and Firefox were not exercised (both lack `beforeinstallprompt`, which is why
the install button renders only when the browser actually offers it), and the
offline fallback was not tested by pulling the network in a browser. The suite
runs unauthenticated against public routes, so it is `contract-fixture`-profile
evidence about layout and PWA wiring — not integration evidence.

## Slice 9 — first real integration evidence against the live API

Phase 3 published the deployed base URL and enabled Firebase email/password on
project `iitm02`. This slice verifies the contract end to end **server to
server**, which sidesteps the CORS restriction that still blocks browser calls
from local development (IR-005).

Method: exchange the device-1 test account's email and password for a real
Firebase ID token via the Identity Toolkit REST endpoint, then call the deployed
API with `Authorization: Bearer <token>`. The token is never printed or stored.

| Request | Status | Observed |
|---|---|---|
| Firebase `signInWithPassword` | 200 | Real ID token issued (921 chars), `localId` present |
| `GET /api/v1/me` | **200** | `{data, meta}`; `data_mode: live`; data carries `id`, `tenant_id`, `display_name`, `preferred_language`, `timezone`, `consents`, `linked_channel_ids`, `version` |
| `GET /api/v1/fields` | **200** | `{items: [], next_cursor: null}` — correct for a new account, and an empty list rather than an error |
| `GET /api/v1/catalog/crops?limit=5` | **503** | `{error, request_id}`; `code: DEPENDENCY_UNAVAILABLE`, `retryable: true`, farmer-safe message |
| `GET /api/v1/tasks?limit=3` | **200** | `{items: [], next_cursor: null}` |
| `GET /api/v1/me` with a bogus token | **401** | `code: UNAUTHENTICATED` — auth is genuinely enforced, not assumed |
| `GET /health/live`, `/health/ready`, `/healthz` | 404 | Documented paths do not match the deployed service; raised as IR-006 |

### What this actually proves

- **Firebase UID to application actor enrolment works.** The test account was
  created through the browser sign-up screen and `/me` returned a populated
  farmer record with a `tenant_id`, so Phase 3's idempotent enrolment ran.
- **The envelope matches this branch's client exactly.** `meta` carries all
  seven expected keys (`request_id`, `schema_version`, `data_mode`,
  `generated_at`, `provenance`, `warnings`, `job_id`) and errors carry
  `code`/`message`/`retryable`. The provisional guesses recorded in slice 3 are
  confirmed correct on the parts the screens depend on — so `ApiError`'s
  branch-on-code design and the visible `data_mode` badge are built on the real
  shape, not a hopeful one.
- **The 503 is the design working, not a fault.** `catalog/crops` cannot answer
  because nothing builds a `ReferenceBundle` on the Phase 2 side. It returns a
  retryable `DEPENDENCY_UNAVAILABLE` with a message safe to show a farmer,
  instead of an empty list that would read as "no crops exist" or a fabricated
  catalogue. `ApiError.isDependencyUnavailable` exists for exactly this, and
  P1-03 must render it as "we cannot check crops right now" rather than as an
  empty state.

### Still not integrated in a browser

Browser requests from `http://localhost:3000` remain blocked by CORS, so the
`live-local` Playwright profile cannot run yet — IR-005 asks for the origin to
be allowed. Until then, screen-level evidence stays `contract-fixture` profile
and is labelled as such.
