# Continue Phase 3 here

All progress is saved in `workstreams/phase-3/progress.md`. Read it, this file, `decisions.md`, `test-evidence.md`, `interface-requests.md`, `contracts/contract_v1.md`, `AGENTS.md`, and the current Git diff before continuing.

Repository: `https://github.com/annam-iitrpr/TeamUnderdawgs-Agrisense.git`.
Branch: `codex/phase-3-platform`. Local checkout: `phase-3/repo` under the supplied workspace.
Requirements: the private parent folder contains `03-PHASE-3-PLATFORM-INTEGRATION.md` and other phase specifications. Supplied secrets are in parent `agrisense.env`; never print or commit values, never add README files.

Current work: initial existing-app import and early shared contract publication. Consult Git log for the exact published commit; the fully verified bootstrap gate has not yet passed. Start next with authenticated FastAPI `/me`, fields/seasons, PostgreSQL migrations and Firebase email/password harness. Keep progress honest, test each slice, scan staged changes and commit/push timely.

Before each commit: `python3 scripts/security/check_staged.py --secret-file ../agrisense.env`, then inspect `git diff --cached --stat` and `git diff --cached --check`. Push only Phase 3 with no force. Fetch Phase 1/2 refs for read-only integration overview; never overwrite their work.

The user additionally requires a full-width desktop site, responsive at all sizes, plus PWA. Phase 1 owns implementation; the directive is in shared contract and interface notes.
