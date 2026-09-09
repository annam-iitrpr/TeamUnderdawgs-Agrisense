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

## D-005 — Fixed undefined CSS utility classes carried by the reference snapshot

**Context.** The snapshot's components reference `.skeleton`, `.animate-rise`, `.score-value` and `.tabular`, but `app/globals.css` defines none of them and `tailwind.config.ts` declares no matching keyframes. Those elements render unstyled (and the "loading" skeleton is invisible).

**Decision.** Define them properly — keyframes in the Tailwind config, component classes in `globals.css` — rather than deleting the usages.

**Why it matters.** This is a real defect inherited from the snapshot, not a cosmetic preference: an invisible skeleton means the loading state the spec requires does not actually exist.
