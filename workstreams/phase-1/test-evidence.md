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
