# AgriSense repository instructions

Read `.agents/skills/karpathy-guidelines/SKILL.md`, `contracts/contract_v1.md`, and your branch's `workstreams/phase-N/progress.md`, decisions, handoff and diff before changes.

Enable the shared hook once per clone: `git config core.hooksPath scripts/hooks`. It blocks
any commit that CI would reject and any staged secret.

User instructions take precedence. Do not commit any README or environment files, credentials, private keys, personal data or test auth state. Run `python3 scripts/security/check_staged.py` on every staged commit; supply the local secret file with `--secret-file` when available. Never print secret values. Update phase-specific progress and handoff after each verified slice. Commit working slices with descriptive conventional commit subjects; push only your branch without force.

Ownership after bootstrap:
- Phase 1 `codex/phase-1-farmer-experience`: web app/components/features/lib (except generated), public/styles, frontend tests and workstreams/phase-1.
- Phase 2 `codex/phase-2-intelligence`: backend agronomy/clients/science, science tests, science data/scripts, workstreams/phase-2.
- Phase 3 `codex/phase-3-platform`: other backend paths, contracts and generated models, infra/scripts, CI, shared configuration, manifests/locks, workstreams/phase-3.

Request cross-owner changes in interface-requests.md. Never recreate scientific constants in the platform or authoritative calculations in JavaScript. Do not enable unauthenticated legacy routes. Synthetic fixtures must remain explicitly labeled.

The UI must be a full-width desktop site, responsive on phones/tablets, with PWA support. Phase 1 implements UI and PWA assets; Phase 3 provides deployment support. Never cache private API responses or bearer tokens in a service worker.
