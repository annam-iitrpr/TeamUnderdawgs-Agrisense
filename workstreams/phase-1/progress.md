# Phase 1 — Farmer experience, UI/UX and agronomist dashboard

Device 1 ledger. Updated at the end of every committed slice.

## Branch state

| Field | Value |
|---|---|
| Branch | `codex/phase-1-farmer-experience` |
| Base | **No `agrisense-contract-v1` tag existed.** Branch started from an empty repository (zero refs on `origin` at clone time). See [decisions.md](decisions.md) D-001. |
| Reference snapshot ported | `AkashaPrasad/AgriSense-AnnamAI` @ `b94a311e9daeeb6247dd2eb5c36647fda03cc9dd` (matches the SHA recorded in the build spec) |
| Last verified commit | see git log; updated per slice |
| Contract version consumed | none yet — `contracts/openapi.yaml` does not exist. Types are hand-written from the spec's route/model tables and marked provisional. |

## Requirement status

Status vocabulary: `pending` · `in-progress` · `verified` · `external-blocked`.

| ID | Requirement | Status | Note |
|---|---|---|---|
| P1-00 | Workstream scaffolding, design system, i18n, API client | in-progress | Foundation slices |
| P1-01 | Authentication and account continuity | pending | Needs Firebase project or Auth Emulator |
| P1-02 | Progressive onboarding and field setup | pending | |
| P1-03 | Crop selection, warnings, top-five comparison | pending | Needs `POST /planning/compare` |
| P1-04 | Home dashboard, field switching, data requests | pending | |
| P1-05 | Readiness, forecast and biological fit | pending | Needs Phase 2 evaluation output |
| P1-06 | R1 live ROI and water views | pending | Needs `/economics`, `/water` |
| P1-07 | Season Journal and action capture | pending | Needs media upload routes |
| P1-08 | Ask assistant with authorized context | pending | Needs `/conversations`, proposals |
| P1-09 | Notifications, reminders, seven-day to-do | pending | Needs `/tasks`, `/reminders` |
| P1-10 | End season and prediction review | pending | Needs `/seasons/{id}/close` |
| P1-11 | Agronomist dashboard | pending | Needs `/agronomist/*` |

## External blockers

These are recorded as blockers, not worked around with invented data.

1. **No shared bootstrap tag.** Device 3 has not published `agrisense-contract-v1`; `origin` was empty at clone. Phase 1 is proceeding on a provisional base per D-001 and will realign when the tag lands.
2. **No `contracts/openapi.yaml`.** All request/response types in `web/lib/api/` are hand-written from the spec's tables and are provisional until Phase 3 generates authoritative types into `web/lib/generated/**` (Phase 3-owned).
3. **No backend to call.** `web/**` is being built against the `contract-fixture` profile. No slice is reported as integrated until it runs in `live-local` against the real API.
4. **No Firebase Auth Emulator config from bootstrap.** P1-01 needs either the emulator (bootstrap-owned config) or the team Firebase project's web config. Local env values are held outside git.

## Executed commands and results

Recorded per slice below as work proceeds.

### Slice 0 — repository and workstream scaffolding

- `git clone https://github.com/annam-iitrpr/TeamUnderdawgs-Agrisense.git` → empty repository, `git ls-remote origin` returned zero refs.
- `git checkout -b codex/phase-1-farmer-experience` → branch created on unborn HEAD.
- `npm view firebase/zod/next/react/tailwindcss version` → 12.19.0 / 4.6.0 / 16.3.4 / 19.3.0 / 4.3.3. Held Next at `^15.1.6` and Tailwind at `^3.4.17` deliberately (D-003).

## Next concrete step

Install dependencies, verify typecheck/lint/build run clean on the ported base, then land the design-system and i18n slices.

## Integration requests

See [interface-requests.md](interface-requests.md).
