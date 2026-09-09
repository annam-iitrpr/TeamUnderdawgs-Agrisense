# Phase 3 progress

Branch: `codex/phase-3-platform`.
Base: destination origin had no refs at initial inspection; imported source snapshot `b94a311e9daeeb6247dd2eb5c36647fda03cc9dd` from the specification's existing app.
Last verified commit: `28f92b0` (baseline migration). `contract_v1` published at `ff851c3` and tagged.

## Requirement status

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| P3-00 shared contract | done | Published and tagged `contract_v1` at `ff851c3`; 57 operations, generated TS/Pydantic bindings, 6 contract checks passing |
| P3-00 tested bootstrap | in-progress | Dependencies pinned (`uv.lock`), migrations applied, repo-wide ruff pinned. Still needed: Firebase browser harness, CI workflow, one-command local runtime |
| P3-01 database/auth | done | 30 tables live on local PostgreSQL 14 and Cloud SQL PostgreSQL 16; Firebase verification and first-request enrollment; legacy unauthenticated router and public `/uploads` mount no longer served |
| P3-02 API workflows | in-progress | All 57 routes dispatch from the frozen registry with auth, idempotency, versioning and pagination. Fields, seasons, journal, tasks, reminders, notifications, conversations and closure are implemented; media, soil and catalog still return dependency state |
| P3-03 jobs/outbox | in-progress | Outbox rows and job records are written transactionally; no worker drains them yet |
| P3-04 WhatsApp | pending | local secret inventory remains private; no external messages sent |
| P3-05 media/Gemini | pending | no live smoke test yet |
| P3-06 assistant | pending | proposal contract defined |
| P3-07 reminders/analytics | pending | task/notification/reminder distinctions defined |
| P3-08 deployment | pending | Cloud Run is specified host; no cloud resources created |
| P3-09 env | in-progress | Supplied `agrisense.env` stays outside the repo. Confirmed present: Firebase, Cloud SQL, WhatsApp, meteoblue, CEHub. Confirmed absent: `META_APP_SECRET`, any Gemini key/model |
| P3-10 live setup | in-progress | Cloud SQL reachable via Auth Proxy and migrated. Weather, WhatsApp and Gemini not yet exercised live |
| P3-11 acceptance | pending | full test matrix not yet run |
| P3-12 integration | in-progress | Phase 2 branched from `ff851c3` and shares ancestry. Phase 1 started from an unrelated root, so `.gitignore` and `web/` will need a reconciled merge |

## Executed checks

- `git ls-remote origin`: destination repository empty.
- Existing source HEAD matches specification snapshot.
- `uv python install 3.12`: Python 3.12 already available; isolated backend environment created.
- Contract generator: `--check` reports artifacts consistent; regeneration is reproducible.
- `pytest tests/platform`: 16 passed (6 contract, 10 API).
- `ruff check .`: clean across backend, contracts and scripts under the pinned rule set.
- `alembic upgrade head` -> `downgrade base` -> `upgrade head` -> `alembic check`: applies, reverses and reports no drift on local PostgreSQL 14.
- Same migration applied to Cloud SQL `iitm02:asia-south1:agrisense-db`: 30 tables, revision `ba1423b0e662`, no drift.
- Staged-file secret scan passed before each of the three commits.
- Reviewed community Karpathy skill at pinned commit; MIT license fetch returned 404 and attribution/license completion remains pending.

## Decisions and new requirements

- User prioritized immediate `contract_v1` publication. Publish early interfaces separately from the fully tested `agrisense-contract-v1` bootstrap tag; never claim unrun gates passed.
- Use the requested separate Phase 3 branch immediately; avoid independent bootstrap histories.
- README publication forbidden; `.gitignore` also excludes environment files, credentials, runtime databases/media/auth/browser state.
- User requires full-width desktop UI, responsive across screen sizes and PWA. Shared handoff communicates this to Phase 1; Phase 3 supplies hosting/cache support.
- User requests a continuation handoff before ending/context exhaustion. See `handoff.md`.

## Cloud SQL connectivity: diagnosis and resolution

The supplied `DATABASE_URL` targets the `/cloudsql/iitm02:asia-south1:agrisense-db` unix
socket, which exists only inside Cloud Run with a Cloud SQL connection attached; on any
workstation it fails with "No such file or directory". The documented public IP times out
instead, because the instance publishes `authorizedNetworks: null` — public IP is enabled
with zero networks allowed.

Resolved with the Cloud SQL Auth Proxy (`scripts/dev/cloudsql_proxy.sh`), which authorizes
with Application Default Credentials and always encrypts. No developer address was added to
the shared instance: the address is dynamic, and the instance still runs
`sslMode: ALLOW_UNENCRYPTED_AND_ENCRYPTED`, so an open public IP would also accept
unencrypted traffic. Recommend tightening that to encrypted-only before launch; it is a
shared-infrastructure change and has not been made unilaterally.

Only Phase 3 needs database access. Phase 1 (frontend over HTTP) and Phase 2 (pure science
functions over contract snapshots) require no change.

Next concrete step: durable job worker and outbox drain, then media upload tickets and the
Firebase browser authentication harness.

## Contract publication validation

- `backend/.venv/bin/python -m pytest backend/tests/platform/test_contracts.py -q`: **6 passed**. Validates all 57 operations, schema references/auth/idempotency, 21 synthetic fixtures, UTC interval validation, null-versus-zero, quantile ordering and forbidden client identity fields.
- `scripts/generate_contracts.py --check`: passed; all generated artifacts and hashes match.
- Early tag: `contract_v1`; completed bootstrap tag remains reserved.
