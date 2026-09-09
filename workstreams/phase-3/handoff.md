# Continue Phase 3 here

All progress is saved. Read this file, then `progress.md`, `decisions.md`,
`interface-requests.md`, `test-evidence.md`, `contracts/contract_v1.md`, `AGENTS.md`, and the
current `git log` before changing anything.

## Where things stand

Repository: `https://github.com/annam-iitrpr/TeamUnderdawgs-Agrisense.git`
Branch: `codex/phase-3-platform` — pushed, CI green.
Checkout: `phase-3/repo`; requirements and `agrisense.env` are in the parent directory, which
is outside the repository and must stay that way.

Working and covered by tests:

- `contract_v1`, tagged, consumed by Phase 2 already.
- 57 routes dispatching from the frozen registry with Firebase auth, tenant isolation,
  optimistic versioning, idempotent POSTs and cursor pagination.
- PostgreSQL schema at revision `7d0b0fa1bb6f`, applied to local PostgreSQL 14 and to
  Cloud SQL `iitm02:asia-south1:agrisense-db`.
- Durable jobs and a per-consumer outbox.
- Media custody with verified digests and short-lived owner-only reads.
- Signature-verified WhatsApp ingestion with one-time link codes.
- CI, container image and Cloud Run service definition.

## How to run things

```
scripts/dev/cloudsql_proxy.sh                      # Cloud SQL on 127.0.0.1:5433
cd backend && AGRISENSE_ENV_FILE=/dev/null \
  DATABASE_URL="postgresql+psycopg://<user>@127.0.0.1:5432/agrisense_dev" \
  .venv/bin/python -m alembic upgrade head
cd backend && AGRISENSE_ENV_FILE=/dev/null .venv/bin/python -m pytest tests/platform -q
backend/.venv/bin/python scripts/generate_contracts.py --check
backend/.venv/bin/python -m ruff check .
```

The env file's `DATABASE_URL` is a Cloud Run unix socket and will not work on a workstation;
use the proxy. Never print or commit any value from that file.

## Rules that must not slip

- Before every commit: `python3 scripts/security/check_staged.py --secret-file ../agrisense.env`,
  then read `git diff --cached --stat`. Run `ruff check .` and the tests too — check the exit
  code directly rather than through a pipe, which swallows it.
- Never commit a README or any environment file. Push only this branch, never force.
- Never invent an agronomic value, a coefficient, or a provider result. A missing dependency
  answers 503 `DEPENDENCY_UNAVAILABLE`. This is the single most important rule in the project.
- Do not edit files owned by Phase 1 (`web/`) or Phase 2 (`backend/agrisense/science`,
  `agronomy`, `clients`). Raise changes in `interface-requests.md` instead.

## What to do next

1. Firebase email/password browser harness proving real token verification end to end.
2. Assistant proposal loop behind a guarded Gemini client, mirroring
   `backend/agrisense/platform/science.py`. Gemini is not configured in the supplied env, so
   it must degrade honestly.
3. Reminder scheduling with quiet hours and the notification delivery path.
4. Deploy a Cloud Run revision; secrets go to Secret Manager, never into the service YAML.
5. Integration: all three branches now share ancestry. Phase 1 merged `contract_v1` and
   resolved their conflicts by ownership, so the unrelated-root reconciliation this file
   previously listed is done and no longer outstanding.

## Open items owned by others

- Phase 2: nothing builds a `ReferenceBundle`, so evaluation cannot complete. The gateway
  already probes three candidate entrypoint names and needs no change once one is published.
- Phase 1: full-width responsive desktop site plus installable PWA, and retire the
  provisional API types in favour of `web/lib/generated/api.ts`.
- User/operator: `META_APP_SECRET` and Gemini configuration are absent from `agrisense.env`;
  WhatsApp ingestion and any AI feature stay disabled until they are supplied. The Cloud SQL
  instance still allows unencrypted connections (`sslMode: ALLOW_UNENCRYPTED_AND_ENCRYPTED`);
  tightening it is recommended before launch but was not changed unilaterally.
