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
| Contract version consumed | `contract_v1`, **adopted**. `web/lib/api/contract.ts` aliases the generated schemas; `web/lib/api/types.ts` is deleted. A `satisfies keyof paths` guard on the 27 consumed routes fails typecheck if a regeneration renames one. |

## Migration debt created by the merge

1. **Two i18n modules coexist.** `lib/locale/` (this branch: five languages,
   completeness gate) and `lib/i18n.ts` (bootstrap: three languages, used by the
   pre-existing screens). Rationale and exit condition in D-007.
2. ~~**Provisional API types vs generated types.**~~ **RESOLVED in slice 7.**
   `types.ts` deleted; everything derives from `web/lib/generated/api.ts`. Six
   shapes had been guessed wrong (area units, water unit, two enums, soil
   measurements, location) — see test-evidence.md slice 7.
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
| P1-01 | Authentication and account continuity | in-progress | Round trip **verified against real Firebase** (create, verify-mail, sign-out, wrong-password rejection, sign-in, refresh persistence). Remaining: authorized API call with the issued token, second-tenant denial, token-expiry recovery, WhatsApp identity linking |
| P1-02 | Progressive onboarding and field setup | **integrated** | Six steps built; field creation verified end to end against the live API with a persisted record and proven idempotency. Remaining: soil-card upload, season creation (blocked on the crop catalogue), place search (blocked on the location catalogue), Playwright coverage |
| P1-03 | Crop selection, warnings, top-five comparison | external-blocked | `GET /catalog/crops` and `POST /planning/compare` answer 503 `DEPENDENCY_UNAVAILABLE` — nothing builds a `ReferenceBundle` on the Phase 2 side. Onboarding already renders this honestly. |
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

1. ~~**No shared bootstrap tag.**~~ **RESOLVED.** Phase 3 published `contract_v1` and it is merged in (D-006).
2. ~~**No `contracts/openapi.yaml`.**~~ **RESOLVED.** It exists (as JSON, schemas only — the route registry lives in `contracts/routes.py`), and generated TS types are at `web/lib/generated/api.ts`. Adopting them is the current slice, not a blocker.
3. ~~**No backend to call.**~~ **PARTLY RESOLVED.** Phase 3 reports 57 routes serving `contract_v1` with Firebase auth, tenant isolation, versioning and idempotency, plus PostgreSQL at revision `7d0b0fa1bb6f`. Not yet exercised from this branch — running it locally needs Docker PostgreSQL and a backend venv. Until that happens, no Phase 1 slice may be reported as integrated.
4. ~~**No Firebase Auth Emulator config from bootstrap.**~~ **RESOLVED** by using the team's real Firebase web config; see blocker 5.
6. **`/seasons/{id}/evaluate` cannot complete.** Phase 3 records that nothing builds a `ReferenceBundle` on the Phase 2 side, so evaluation dead-letters with `DEPENDENCY_UNAVAILABLE` by design. P1-05 therefore cannot show a real readiness result yet, regardless of Phase 1 progress. Owned by Phase 2.
7. **Gemini and `META_APP_SECRET` are absent from the supplied env.** Per Phase 3, AI features and WhatsApp ingestion stay disabled. Affects P1-08's assistant, which must degrade honestly rather than appear to work.
5. ~~**Auth Emulator cannot run on this machine.**~~ **RESOLVED 2026-09-10.** `java`/`firebase-tools` are still absent, but the team's real Firebase web config in `agrisense.env` was used instead (public client config, emulator URL omitted), and the full dev-account round trip is now verified against the live `iitm02` project. See test-evidence.md slice 6. Outstanding sub-parts are tracked on the P1-01 row rather than as a blocker.

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

### Slice 5 — merged the `contract_v1` bootstrap

- Fixed the no-common-ancestor problem: `contract_v1` is now an ancestor of this
  branch, so three-way integration behaves normally (D-006).
- 12 conflicts resolved by ownership; `lib/locale/` rename to stop the
  bootstrap's `lib/i18n.ts` shadowing this branch's module (D-007).
- Fixed two real defects in the bootstrap's chart screens where an absent stress
  type rendered as zero instead of unknown.
- `tsc` 0, `next lint` clean, `next build` 0 with 15 routes, 62/62 unit tests,
  both my screens and the legacy screens verified in a browser.

### Slice 6 — P1-01 round trip against real Firebase

- Pointed `web/.env.local` at the team's live Firebase project (`iitm02`) using
  the public web config from `agrisense.env`, emulator URL omitted.
- Verified in a browser: account creation, verification mail, sign-out,
  wrong-password rejection with the non-enumerating message, sign-in, and
  session persistence across a full reload. No console errors throughout.
- Closes blocker 5. Details and what remains uncovered in test-evidence.md.

## Next concrete step

1. Retire the provisional types in `web/lib/api/types.ts` in favour of
   `web/lib/generated/api.ts` (explicitly requested by Phase 3, and prevents
   drift). Real shapes differ from the guesses in ways that matter:
   `entered_area_unit` has four values not two, water is `available_water_m3`
   not litres, `date_confidence` is `confirmed|estimated|unknown`, and soil
   values are `Measurement` objects.
2. Desktop and PWA work, per the user directive relayed in Phase 3's interface
   requests: the inherited phone-frame layout is not acceptable as the desktop
   site. Acceptance is no horizontal overflow at 360/768/1280/1920px, an
   installable manifest, and authenticated content never cached offline. Doing
   this before the feature screens avoids building ten screens twice.
3. Then P1-02 onboarding, P1-03 comparison and P1-04 dashboard against the live
   API rather than fixtures, since the API now exists.
