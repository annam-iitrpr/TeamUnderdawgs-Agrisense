# Phase 3 progress

Branch: `codex/phase-3-platform`.
Base: destination origin had no refs at initial inspection; imported source snapshot `b94a311e9daeeb6247dd2eb5c36647fda03cc9dd` from the specification's existing app.
Last verified commit: pending first contract publication (see Git history; this file is updated in each progress commit).

## Requirement status

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| P3-00 shared contract | in-progress | 57 public operations, strict domain/science/event models, generated TS/Pydantic and hashes; 6 contract checks passed |
| P3-00 tested bootstrap | pending | dependency pinning, migrations, Firebase browser harness, CI and local runtime still required; no completed bootstrap tag yet |
| P3-01 database/auth | pending | inspected inherited unauthenticated legacy API; replacement must default closed |
| P3-02 API workflows | pending | schemas published before route implementations |
| P3-03 jobs/outbox | pending | no durable worker yet |
| P3-04 WhatsApp | pending | local secret inventory remains private; no external messages sent |
| P3-05 media/Gemini | pending | no live smoke test yet |
| P3-06 assistant | pending | proposal contract defined |
| P3-07 reminders/analytics | pending | task/notification/reminder distinctions defined |
| P3-08 deployment | pending | Cloud Run is specified host; no cloud resources created |
| P3-09 env | in-progress | supplied `agrisense.env` stays outside repo; all env/README files ignored |
| P3-10 live setup | pending | verify capabilities without exposing secrets |
| P3-11 acceptance | pending | full test matrix not yet run |
| P3-12 integration | pending | remote currently has no Phase 1/2 refs; do not merge until streams are verified |

## Executed checks

- `git ls-remote origin`: destination repository empty.
- Existing source HEAD matches specification snapshot.
- `uv python install 3.12`: Python 3.12 already available; isolated backend environment created.
- Contract generator: successful; semantic and fixture checks passed.
- Reviewed community Karpathy skill at pinned commit; MIT license fetch returned 404 and attribution/license completion remains pending.

## Decisions and new requirements

- User prioritized immediate `contract_v1` publication. Publish early interfaces separately from the fully tested `agrisense-contract-v1` bootstrap tag; never claim unrun gates passed.
- Use the requested separate Phase 3 branch immediately; avoid independent bootstrap histories.
- README publication forbidden; `.gitignore` also excludes environment files, credentials, runtime databases/media/auth/browser state.
- User requires full-width desktop UI, responsive across screen sizes and PWA. Shared handoff communicates this to Phase 1; Phase 3 supplies hosting/cache support.
- User requests a continuation handoff before ending/context exhaustion. See `handoff.md`.

Next concrete step: publish the validated early shared contract, then implement authenticated enrollment, field/season persistence and migrations against it.

## Contract publication validation

- `backend/.venv/bin/python -m pytest backend/tests/platform/test_contracts.py -q`: **6 passed**. Validates all 57 operations, schema references/auth/idempotency, 21 synthetic fixtures, UTC interval validation, null-versus-zero, quantile ordering and forbidden client identity fields.
- `scripts/generate_contracts.py --check`: passed; all generated artifacts and hashes match.
- Early tag: `contract_v1`; completed bootstrap tag remains reserved.
