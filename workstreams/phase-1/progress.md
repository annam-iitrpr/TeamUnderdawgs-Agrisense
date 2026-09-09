# Phase 1 — Farmer experience, UI/UX and agronomist dashboard

Device 1 ledger. Updated at the end of every committed slice.

## Branch state

| Field | Value |
|---|---|
| Branch | `codex/phase-1-farmer-experience` |
| Base | Started from an empty repository (zero refs on `origin` at clone time) because no bootstrap tag existed. See [decisions.md](decisions.md) D-001. |
| Reference snapshot ported | `AkashaPrasad/AgriSense-AnnamAI` @ `b94a311e9daeeb6247dd2eb5c36647fda03cc9dd` (matches the SHA recorded in the build spec) |
| Bootstrap | `contract_v1`, published by Phase 3 **after** this branch had five commits — and note the tag name differs from the spec's `agrisense-contract-v1`. Merged in per D-006, so the bootstrap is now an ancestor of this branch and three-way integration behaves normally instead of as an unrelated-history graft. |
| Last verified commit | see git log; updated per slice |
| Contract version consumed | `contract_v1`. Generated types exist at `web/lib/generated/api.ts` but are **not yet adopted** — the provisional hand-written types in `web/lib/api/` are still in use. Migration is the next slice. |

## Migration debt created by the merge

1. **Two i18n modules coexist.** `lib/locale/` (this branch: five languages,
   completeness gate) and `lib/i18n.ts` (bootstrap: three languages, used by the
   pre-existing screens). Rationale and exit condition in D-007.
2. **Provisional API types vs generated types.** `web/lib/api/types.ts` was
   hand-written before `contract_v1` existed. `web/lib/generated/api.ts` is now
   authoritative and should replace it. The `{data, meta}` envelope and the
   five-language enum match what was guessed, so this is a mechanical migration
   rather than a redesign.
3. **Legacy screens still call the pre-v1 API.** `app/field/**` and
   `app/dashboard/**` use `lib/api.ts` against `/api/...`, not `/api/v1`. They
   are replaced under P1-04 and P1-05.
4. **Legacy error text is English-only.** The pre-existing screens surface
   hardcoded English strings from `lib/api.ts`, so a Telugu session sees an
   English failure message. Pre-existing rather than introduced here; fixed as
   those screens migrate.

## Requirement status

Status vocabulary: `pending` · `in-progress` · `verified` · `external-blocked`.

| ID | Requirement | Status | Note |
|---|---|---|---|
| P1-00 | Workstream scaffolding, design system, i18n, API client | verified | Typecheck, lint, build and 62 unit tests pass |
| P1-01 | Authentication and account continuity | in-progress | Screens, validation, localisation and build verified in browser. **Auth round trip NOT exercised** — no Auth Emulator on this machine (blocker 5) |
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
5. **Auth Emulator cannot run on this machine.** Neither `java` nor `firebase-tools` is installed, so the mandatory dev-account discipline (sign up through the real UI, sign out, sign back in, refresh, then call the API with an issued token) has not been performed. Rendering, validation and localisation are verified in a browser; the authentication round trip is not. Unblocking needs a JDK plus `firebase-tools`, or the team's real Firebase web config and a staging test account.

## Executed commands and results

Recorded per slice below as work proceeds.

### Slice 0 — repository and workstream scaffolding

- `git clone https://github.com/annam-iitrpr/TeamUnderdawgs-Agrisense.git` → empty repository, `git ls-remote origin` returned zero refs.
- `git checkout -b codex/phase-1-farmer-experience` → branch created on unborn HEAD.
- `npm view firebase/zod/next/react/tailwindcss version` → 12.19.0 / 4.6.0 / 16.3.4 / 19.3.0 / 4.3.3. Held Next at `^15.1.6` and Tailwind at `^3.4.17` deliberately (D-003).

### Slice 1 — design tokens, base styles, shared formatters

- `npm install --no-audit --no-fund` → exit 0.
- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → exit 0, 26/26 passing.
- Defined the four utility classes the reference snapshot used but never
  declared (`.skeleton`, `.animate-rise`, `.score-value`, `.tabular`), so
  loading states are visible rather than blank (decisions.md D-005).
- Added `lib/format.ts` as the single date/area/money formatter, pinned to
  `Asia/Kolkata`, with unknown-not-zero handling throughout.

### Slice 2 — five-language i18n with completeness gate

- `npx vitest run` → exit 0, 43/43 passing (26 format + 17 i18n).
- `npx tsc --noEmit` → exit 0.
- Dictionaries for `en`, `hi`, `mr`, `pa`, `te` under `lib/i18n/`, keyed and
  compiled — no runtime LLM generation of menus.
- Non-English dictionaries are `Partial<Dict>` on purpose: an untranslated key
  falls back to English and is *reported* by the completeness test, rather than
  forcing fabricated translations to satisfy the compiler.
- `REVIEW_STATUS` records all four non-source languages as `pending-review`.

### Slice 3 — provisional v1 API client and query discipline

- `npx tsc --noEmit` → exit 0; `npx vitest run` → 57/57.
- Envelope, provisional domain types, auth-aware client, query-key isolation.

### Slice 4 — P1-01 authentication screens (partial)

- `npx tsc --noEmit` → exit 0; `npx next lint` → no warnings or errors;
  `npx next build` → exit 0, 5 routes prerendered; `npx vitest run` → 62/62.
- Verified in a browser at `/sign-in` and `/sign-up`: five-language switching,
  Telugu persistence across reload, empty-form validation with icon-plus-text
  errors, focus moved to the first invalid input, no console or hydration
  errors.
- Three real defects found and fixed: a production build failure from
  `useSearchParams()` outside a Suspense boundary; validation errors frozen in
  the language active at submit time; and a password toggle that could overlap
  typed text in languages with longer labels. Details in test-evidence.md.
- **Not done:** the authentication round trip. See blocker 5.

## Next concrete step

Either unblock the Auth Emulator (JDK + `firebase-tools`) to complete P1-01's
round-trip evidence, or proceed to P1-02 onboarding forms, which can be built
and unit-tested without a live identity provider. Recommend proceeding with
P1-02 and returning to P1-01 evidence once tooling or the team's Firebase
config is available.

## Integration requests

See [interface-requests.md](interface-requests.md).
