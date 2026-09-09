# Phase 1 interface requests

Addressed to Phase 3 (contract owner). Each request names the current state, the
proposed change, the reason, an example payload and the affected acceptance test.

---

## IR-001 — Publish the shared bootstrap tag and confirm the realignment path

**Current state.** `origin` had zero refs when Phase 1 cloned it. No
`agrisense-contract-v1` tag, no default branch, no commits.

**Request.** Publish the bootstrap commit and tag, and confirm how Phase 1
should realign: rebase this branch onto the tag, or merge the tag in and keep
history. Phase 1's preference is to merge the tag in once, because commits
already exist here and rebasing rewrites reviewed history.

**Reason.** Every other request below is downstream of the contract that the
bootstrap is supposed to freeze.

**Affected tests.** All of them — the `live-local` Playwright profile cannot run
without a backend and generated types.

---

## IR-002 — Phase 3 should overwrite these Phase 3-owned files, not merge them

**Current state.** The spec assigns `web/package.json`, shared test configs and
lockfiles to Phase 3. None existed, and nothing in `web/` can install, typecheck,
build or test without them, so Phase 1 created provisional versions:

| File | Provenance |
|---|---|
| `web/package.json` | Reference snapshot's dependency set, plus `firebase` and `zod` (D-004) |
| `web/tsconfig.json` | Reference snapshot, plus `noUncheckedIndexedAccess` |
| `web/tailwind.config.ts` | Reference snapshot, plus the keyframes its own components already referenced (D-005) |
| `web/next.config.ts`, `web/postcss.config.mjs`, `web/.eslintrc.json` | Reference snapshot; lint/type checks un-suppressed |
| `web/vitest.config.ts` | Reference snapshot, retargeted at `tests/unit/**` |
| `web/playwright.config.ts` | Rewritten for the spec's `contract-fixture` / `live-local` profiles and 360/390/desktop viewports |

**Request.** At merge, take **Phase 3's** version of each of these wholesale.
Phase 1 asks only that the final pin keeps: the two added dependencies, strict
TypeScript, un-suppressed lint/type checks in the Next build, and the two
Playwright profiles.

**Reason.** Hand-splicing manifests and lockfiles is the merge conflict most
likely to break the integration build.

---

## IR-003 — Generated types location and `{data, meta}` envelope shape

**Current state.** `contracts/openapi.yaml` does not exist. Phase 1 hand-wrote
provisional types in `web/lib/api/` from the spec's route and model tables.

**Request.** Generate TypeScript types into `web/lib/generated/**` (Phase 3-owned
per the spec) and tell Phase 1 the exact module path to import. Confirm the
envelope is literally:

```json
{
  "data": { "...": "route specific" },
  "meta": {
    "request_id": "req_01J...",
    "schema_version": "1.0",
    "data_mode": "live",
    "generated_at": "2026-09-10T04:12:00Z",
    "provenance": [{ "source": "cehub", "live": true, "fetched_at": "2026-09-10T04:00:00Z" }],
    "warnings": []
  }
}
```

and that list responses nest as `data: { items, next_cursor }`.

**Reason.** Phase 1 renders `data_mode`, `provenance` and `warnings` as visible
UI (the honesty labels the spec requires). If the envelope differs, every screen's
status strip is wrong.

**Affected tests.** `tests/e2e/phase1` data-mode badge and provenance assertions.

---

## IR-004 — Confirm the readiness "insufficient data" shape

**Current state.** The spec says a null required component yields
`insufficient_data`, not zero, and that a missing component must render as
unknown rather than a zero-length bar.

**Request.** Confirm that in `Recommendation`, `readiness`, `need`, `timing_fit`
and `viability` are each independently nullable, and that `status` carries
`insufficient_data` while those fields are `null` — rather than the fields being
omitted from the payload entirely.

**Reason.** Phase 1 must distinguish "0" from "unknown" visually. Omitted keys
and `null` keys need different rendering code, so this needs settling before the
P1-05 slice.

**Affected tests.** P1-05 null-versus-zero rendering test (also named in the
Phase 2 spec's Playwright list).
