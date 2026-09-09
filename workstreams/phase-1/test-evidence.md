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
