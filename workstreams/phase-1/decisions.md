# Phase 1 decisions

Each entry records a material choice, why it was made, and what would reverse it.

## D-001 — Proceeding without the shared bootstrap tag

**Context.** The build spec requires Phase 1 to branch from `agrisense-contract-v1`, published by Device 3 after P3-00. At clone time `origin` had **zero refs**: no default branch, no commits, no tags. The spec also says Devices 1 and 2 may "inspect the repository and prepare fixtures until the base tag exists."

**Decision.** Start `codex/phase-1-farmer-experience` from the empty repository and port the existing `web/` application from the reference snapshot named in the spec (`AkashaPrasad/AgriSense-AnnamAI` @ `b94a311`), which is the code the spec instructs us to continue.

**Why not wait.** Waiting produces zero reviewable progress during a fixed-length build sprint, and the operator explicitly directed work to begin. Waiting is also not risk-free: UI work is the longest pole and depends on nothing that only Phase 3 can supply, provided it is built against contract-shaped fixtures.

**Consequences and reversal.** When Device 3 publishes the tag, Phase 1 realigns onto it (see interface-requests.md IR-001). Files that Phase 3 owns but that had to exist for anything to run are listed in IR-002 and should be **replaced by Phase 3's authoritative versions** at merge, not merged line by line.

## D-002 — Commit scope limited to `web/**` and `workstreams/phase-1/**`

**Decision.** This branch commits nothing under `backend/**`, `contracts/**`, `infra/**`, `scripts/**` or `.github/**`, even though the app cannot run end to end without them.

**Why.** Those paths belong to Phases 2 and 3. Committing a Phase 1 guess there would guarantee merge conflicts in exactly the files that are hardest to reconcile (migrations, lockfiles, generated types).

## D-003 — Held Next.js 15 and Tailwind 3 rather than upgrading to 16 / 4

**Context.** Latest published versions on 2026-09-10 are Next 16.3.4 and Tailwind 4.3.3. The reference snapshot uses Next `^15.1.6` and Tailwind `^3.4.17`.

**Decision.** Keep the reference's major versions and let the caret ranges pull current patches.

**Why.** The spec says to "prefer a compatible patched release over an unrelated framework rewrite" and forbids branches upgrading dependencies independently. Tailwind 4 replaces the JS config with CSS-first configuration, which would mean rewriting the entire token layer; Next 16 is a second major bump on top of that. Neither is Phase 1's call to make unilaterally — it is the bootstrap owner's.

**Reversal.** If Phase 3's bootstrap pins Next 16 / Tailwind 4, Phase 1 adopts that pin and migrates the token layer as its own slice.

## D-004 — Two added dependencies only: `firebase` and `zod`

**Decision.** Added `firebase` (P1-01 requires the client SDK for email/password auth) and `zod` (the spec directs Zod/form validation for UX). Did **not** add TanStack Query.

**Why no TanStack Query.** The spec permits it only "if pinned in bootstrap, otherwise preserve a comparably disciplined existing client." No bootstrap exists, so adding it would be an independent dependency upgrade. Phase 1 instead implements a small request layer with the discipline the spec demands: actor/field/season/input-version-scoped keys, abort of stale requests, and no global cache of authenticated responses.

## D-006 — Merged `contract_v1` in rather than rebasing onto it

**Context.** Phase 3 published the bootstrap **after** this branch had five
commits on it, and named the tag `contract_v1` (the spec had said
`agrisense-contract-v1`). Because this branch began from an empty repository
(D-001), `git merge-base` reported **no common ancestor** with either
`codex/phase-2-intelligence` or `codex/phase-3-platform`. Left alone, that
makes the final three-way integration merge behave as an unrelated-history
graft, which is the situation the spec's merge protocol explicitly warns
against.

**Decision.** `git merge contract_v1 --allow-unrelated-histories --no-ff`, and
resolve the 12 conflicts by ownership rather than by picking a side wholesale.

**Why merge and not rebase.** Rebasing would give a cleaner linear history and
make the bootstrap a true ancestor, but it rewrites five already-pushed commits
and needs a force push. The spec says not to force push, and a merge achieves
the thing that actually matters — the bootstrap is now an ancestor of this
branch, so the integrator's `git merge --no-ff` of all three branches behaves
normally.

**Conflict resolution policy applied.**

| Path | Resolution | Reason |
|---|---|---|
| `contracts/**`, `backend/**`, `scripts/**`, `.agents/**`, `AGENTS.md`, `web/lib/generated/**` | Theirs, untouched | Phase 3-owned. Phase 1 does not edit them. |
| `web/package.json` | Ours (= theirs plus `firebase` and `zod`) | Their manifest lacks the two dependencies P1-01 needs. Still Phase 3's to arbitrate: IR-002. |
| `web/tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `vitest.config.ts`, `playwright.config.ts` | Ours | Ours keeps `noUncheckedIndexedAccess`, un-suppressed lint/type errors in the build, the keyframes the components need, and the two E2E profiles the spec requires. |
| `.gitignore` | Union of both | Neither list was a superset. Kept the broader pattern wherever they differed, including their case-insensitive README rule. |
| `web/app/globals.css`, `web/app/page.tsx` | Ours | Phase 1-owned; ours carries the missing utility classes and the auth-gated home. |
| `web/app/layout.tsx` | Union | Ours, with their `AppProvider` nested inside so the pre-existing screens keep working. |
| `web/components/ui.tsx` | Union | Ours, plus their `BuildSprint` and `StressChip`, which the existing journal screen imports. |
| `web/lib/utils.ts` | Union | Ours, plus their four legacy formatters, marked `@deprecated`. |

**Consequences.** Two real defects in the bootstrap's own screens surfaced under
the stricter tsconfig and were fixed: `d.scores[s]` could be `undefined` for a
stress type absent from the record, and assigning that into the chart row let a
missing series read as a zero rather than as unknown. Both now coerce to `null`.

## D-007 — Renamed this branch's i18n module to `lib/locale/`

**Context.** The bootstrap ships `web/lib/i18n.ts` (three languages, consumed by
the pre-existing screens and by its own `components/providers.tsx`). This branch
had built `web/lib/i18n/` as a directory (five languages, completeness gate).
TypeScript resolves `@/lib/i18n` to the `.ts` file before the directory's
`index.ts`, so after the merge every one of this branch's imports would have
silently bound to the three-language legacy module — compiling, but wrong.

**Decision.** Rename this branch's module to `web/lib/locale/` and leave the
bootstrap's `lib/i18n.ts` in place for the screens that still use it.

**Why not delete the legacy module.** Its keys are a different set entirely
(`sprayOn`, `hoursTitle`, `journalTitle`, and so on) and its `stressLabel`
helper is used by two chart screens. Folding those into `lib/locale/` means
porting roughly sixty keys into five languages, and the completeness gate would
correctly fail until Punjabi and Telugu were done. That is P1-04/P1-05 work, not
merge work. Deleting the module now would instead break working screens.

**Reversal.** When the last screen importing `@/lib/i18n` is rewritten, delete
`lib/i18n.ts` and `components/providers.tsx`, then optionally rename
`lib/locale/` back. Tracked as migration debt in progress.md.

## D-005 — Fixed undefined CSS utility classes carried by the reference snapshot

**Context.** The snapshot's components reference `.skeleton`, `.animate-rise`, `.score-value` and `.tabular`, but `app/globals.css` defines none of them and `tailwind.config.ts` declares no matching keyframes. Those elements render unstyled (and the "loading" skeleton is invisible).

**Decision.** Define them properly — keyframes in the Tailwind config, component classes in `globals.css` — rather than deleting the usages.

**Why it matters.** This is a real defect inherited from the snapshot, not a cosmetic preference: an invisible skeleton means the loading state the spec requires does not actually exist.
