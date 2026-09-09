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

## Slice 10 — P1-02 foundation: area normalisation and draft persistence

The two places where an onboarding bug would be silent and expensive, built and
tested before any of the six screens.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Unit tests | `npx vitest run` | exit 0 — **108 passed / 108**, 7 files (was 74) |

### Area normalisation — 17 tests

- Every unit in the contract converts correctly: acre to 0.4046856422 ha,
  10,000 sqm to 1 ha, and the **Punjab kanal** to 0.0505857 ha (8 kanal ≈ 1
  acre). `kanal` is explicitly flagged as regionally ambiguous — see D-008.
- Every unit round-trips through hectares and back.
- A comma decimal separator is accepted, since several Indian keyboards emit it.
- `"two acres"`, `"2 acres"`, `"1.2.3"`, `"1e5"` and `"-3"` are all rejected,
  and an empty entry is reported distinctly from a malformed one so the UI can
  show the right message.
- Zero and negative areas are rejected rather than accepted as a field.
- The plausibility guard is applied **after** conversion, not before:
  50,000,000 sqm is 5,000 ha and is accepted, so a large typed number in a small
  unit is not rejected for looking big.
- Rounding to six decimals removes float artefacts (2.5 acres → exactly
  1.011714 ha) without collapsing a 100 m² plot to zero.

### Draft persistence — 17 tests

- A draft round-trips, so a refresh restores unfinished work.
- The typed area survives verbatim (`"2,50"` stays `"2,50"`), because the
  echo-back has to show the farmer their own number rather than a reformatted one.
- Drafts are scoped per account: farmer B cannot load farmer A's draft, and
  clearing one leaves the other intact.
- Everything is stored under the `agrisense.draft.` prefix that the auth
  provider purges on sign-out and on identity change — asserted by enumerating
  storage with the same `key()`/`length` API that purge uses.
- **The idempotency key is generated once, with the draft, and survives a
  reload.** This is the actual mechanism behind "submitting twice creates one
  field": a retry after a timeout reuses the same key so the server collapses
  the writes. Generating it at submit time would defeat it.
- A draft written by an older shape, corrupt JSON, or JSON that is not a draft
  all return `null` rather than throwing or resuming a half-understood structure.
- Step gating requires only service consent, a location and a valid area.
  Crop and soil can both be deferred and the field still submits — the spec is
  explicit that missing *optional* information must raise a visible data request
  later rather than block onboarding.

**Not built yet:** the six onboarding screens themselves. This slice is the
logic beneath them.

## Slice 11 — P1-02 onboarding, verified end to end against the live API

**This is the first Phase 1 feature that is genuinely integrated**: browser →
real Firebase auth → live Cloud Run API → Cloud SQL, with a persisted record to
show for it.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npx next lint` | exit 0, clean |
| Unit tests | `npx vitest run` | exit 0 — 108/108 |
| Browser walk-through | dev server against the live API | all six steps exercised |
| **Field created** | `POST /api/v1/fields` from the browser | **201**, redirected to `/?field=45470b013e054b38860e181a0ab86158` |
| **Persisted server-side** | `GET /api/v1/fields` with a real ID token | 1 field, `data_mode: live` |
| **Idempotency** | same `Idempotency-Key` POSTed twice | both 201, **same id**, one field created |

### The persisted record

```json
{ "id": "45470b013e054b38860e181a0ab86158", "name": "North field",
  "area_ha": 1.011714, "entered_area": 2.5, "entered_area_unit": "acre",
  "irrigation_method": "drip", "version": 1,
  "centroid": {"latitude": 30.90099, "longitude": 75.8573,
               "precision_m": 14.0, "source": "gps"} }
```

`2.5 acre` became `1.011714 ha` — the correct conversion at the intended
six-decimal precision — while the farmer's own `2.5` and `acre` were preserved
alongside it, which is exactly what the echo-back on screen showed.

### Behaviour verified in the browser

- **Consent gating.** `Next` is disabled until the required service consent is
  ticked. The two optional opt-ins are separate controls, labelled Optional, and
  neither is needed to proceed — bundling them would make consent coerced.
- **Draft restore.** Reloading mid-flow returned to the same step with every
  answer intact and a "We kept what you had already entered" notice.
- **Area echo-back.** Entering `2.5` with `acre` selected displayed "That is
  **1.01 ha** (2.5 acre)". Switching to `kanal` recomputed to **0.13 ha** and
  raised the ambiguity warning naming the Punjab kanal. This is the unit-slip
  guard working: the farmer sees the consequence of the unit before saving.
- **Approximate location is never passed off as GPS.** Entering a village or
  pincode stores `source: "village"` with a 5 km precision and *cannot* satisfy
  the step, because turning a place name into coordinates needs the location
  catalogue, which is not being served. The screen says so and tells the farmer
  to use GPS or come back — a blocked path with a stated reason rather than a
  silent dead end.
- **Crop and soil are deferrable.** Both steps advance without an answer, and
  the field still saves — the spec requires missing *optional* data to raise a
  visible request later rather than block onboarding. Selecting either crop
  branch states plainly that the crop catalogue is unavailable instead of
  offering an empty list or a hardcoded one.
- **Failure handling.** Before the base URL was corrected the save attempt hit a
  dead local backend, and the screen showed "We cannot reach AgriSense right
  now", kept every answer, and left Save retryable. That was the network path
  behaving correctly, and it was how the misconfiguration was found.

### Idempotency is now a verified claim, not a promise

The review screen tells the farmer "Saving creates this field once. If the
connection drops and you try again, it will not create a duplicate." That was
tested directly: the same `Idempotency-Key` POSTed twice returned **201 with the
same field id both times**, and the account still held exactly one such field.
The key is minted with the draft and persisted with it, so a retry after a
timeout genuinely reuses it. The probe field was archived afterwards to leave
the test account tidy.

### Correction to IR-005

CORS is **not** blocking local development. Probed from `http://localhost:3000`:
a simple GET, and a POST carrying `Content-Type` and `Idempotency-Key` (which
requires a preflight), both reached the API and returned a normal `401` rather
than being blocked. The earlier failure was entirely local — `NEXT_PUBLIC_API_BASE`
still pointed at `127.0.0.1:8000`, where nothing was listening. IR-005 is
withdrawn.

### Not covered

The soil-card upload path is not built (media routes not wired on this screen);
choosing "I have a card" says so. No season is created, because `SeasonCreate`
requires a `crop_id` and the catalogue is unavailable. Geolocation itself was
seeded rather than granted through a real permission prompt, so the GPS
permission flow is untested. No Playwright coverage for this flow yet — it needs
an authenticated fixture.

## Slice 12 — P1-04 field dashboard, against live data

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 (after a real fix, below) |
| Lint | `npx next lint` | clean |
| Unit tests | `npx vitest run` | 108/108 |
| Playwright | `npx playwright test --project=desktop` | **24 passed** (was 20) |
| Browser, live data | dev server against the deployed API | dashboard renders the persisted field with a **"Live data"** badge |

### Two real defects found

1. **Language switcher rendered twice on desktop and not at all on mobile.**
   The header switcher carried `hidden lg:flex` while the sidebar already
   provides one from `lg` up — so the classes were inverted. On a phone, where
   the sidebar is hidden, there was **no way to change language at all**, which
   fails the exact audience the feature exists for. Fixed to `lg:hidden`, and a
   Playwright assertion now requires exactly one visible switcher at each of the
   four breakpoints, so this cannot regress silently.
2. **`Season.crop_name` does not exist.** Another provisional-type assumption,
   caught by the compiler after the migration. The contract's `Season` carries
   only `crop_id`; resolving it to "Cotton" needs `/catalog/crops`, which is
   503. The card shows the raw id and says why, rather than mapping ids to names
   from a hardcoded table — which would be a fabricated catalogue.

### Verified against the real record

The dashboard reads the field created in slice 11 and renders it from live data:
`North field · 1.01 ha · GPS location · Drip`, with the `data_mode: live` badge
taken from the response envelope rather than assumed.

### Honest states, each deliberate

- **No crop set**: explains that a spray window, water plan and return estimate
  all depend on the crop, so nothing can be calculated — then states that the
  crop catalogue is not being served, that it is a service problem rather than
  the farmer's mistake, and that the field is saved.
- **Data requests** are real: "Add the crop for this field" and "Add a soil
  test" render as *blocked* with the reason ("Crop catalogue unavailable",
  "Upload not built yet") instead of as buttons that would fail when tapped.
  Requests that can be actioned link to the relevant form.
- **No readiness score is shown.** With no recommendation available the card
  says so explicitly, because an empty progress bar reads as "no risk" rather
  than "not known", and Phase 1 must never compute agronomy in the browser.
- Loading, error and empty-field states are all distinct, and the retry action
  appears only when the error is actually retryable.

### Field isolation

Every query key carries the actor and, for season queries, the field id and
version. `FieldPanel` is additionally keyed on the field id so switching fields
remounts rather than briefly showing the previous field's data under the new
heading. Only one field exists on the test account, so **the two-field race has
not been exercised end to end** — it needs a second field and a throttled
response, and is listed as pending rather than claimed.

## Slice 13 — real place search removes the GPS-declined dead end

Phase 3 shipped location search, and `GET /catalog/locations` now answers **200
with live results**. That removes a dead end documented in slice 11: a farmer
who declined GPS previously could not complete onboarding at all, because
turning a place name into coordinates had no service behind it.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npx next lint` | clean |
| Unit tests | `npx vitest run` | 108/108 |
| Playwright | `npx playwright test --project=desktop` | 24/24 |
| Production build | `npx next build` | exit 0, `/onboarding` 8.73 kB |
| **Live search** | typed "Ludhiana" in the browser | 2 real results from the deployed API |

### What the search returned

```
Ludhiana   — Ludhiana district, Punjab
Ludhiāna   — Bulandshahr district, Uttar Pradesh
```

Both are shown with district and state, which matters: two settlements share
the name in different states, and picking the wrong one would put the field
about 900 km away. Disambiguation is the farmer's to make, with the information
needed to make it.

### Draft state after selecting the Punjab result

```json
{ "label": "Ludhiana, Ludhiana district, Punjab",
  "latitude": 30.91204, "longitude": 75.85379,
  "precisionM": 5000, "source": "village" }
```

`nextEnabled: true` — the step is now satisfiable without GPS.

The centroid **is** saved as the field's coordinates, because the contract
requires one, but it carries `source: "village"` and a 5 km precision rather
than `gps`, and the UI says in plain words that this is the centre of the place
and not the field, so advice will be less specific. Nothing downstream can
mistake a settlement centroid for a surveyed position.

If the endpoint regresses to 503 the screen says place search is unavailable and
points the farmer back at GPS, rather than silently returning no matches — an
empty result and an unavailable service are different things and read
differently.

**Not covered:** pincode-only queries were not tested (only a place name), and
the probe draft was cleared afterwards so no test state remains on the device.
