# Phase 1 handoff

Filled in as slices complete. Nothing is listed here until it actually runs.

## Completed routes and screens

_None yet — foundation slices in progress._

## Backend contract versions consumed

None. `contracts/openapi.yaml` does not exist; provisional hand-written types in
`web/lib/api/` (see interface-requests.md IR-003).

## Exact test commands

```bash
cd web
npm ci
npm run typecheck
npm run lint
npm run test                          # unit
npm run test:e2e                      # contract-fixture profile (default)
E2E_PROFILE=live-local npm run test:e2e   # integration; needs Phase 3 backend
```

## Known external blockers

Mirrored from progress.md: no bootstrap tag, no generated contracts, no backend
to call, no bootstrap-supplied Firebase Auth Emulator configuration.

## Required integration requests

IR-001 through IR-004 in interface-requests.md.

## Final commit

_Recorded at handoff._
