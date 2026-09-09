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
