# Test evidence

Nothing below is claimed unless it was actually run. Python 3.12.13, Pydantic 2.13.5.

## Automated, green in CI

- `scripts/generate_contracts.py --check`: artifacts consistent and regeneration reproducible.
- `ruff check .`: clean across backend, contracts and scripts under the pinned rule set.
- `pytest tests/platform`: 42 tests (40 offline, 2 live-only) covering the contract, the
  authenticated API, tenant isolation, versioning, idempotency, pagination, durable jobs,
  the per-consumer outbox, media custody and WhatsApp ingestion.
- Migrations: `upgrade head` -> `downgrade base` -> `upgrade head` -> `alembic check` on
  PostgreSQL 16 in CI and PostgreSQL 14 locally; no drift.
- `pip-audit`: no known vulnerabilities in the locked dependency set.
- Tracked-file secret scan: no environment file, credential or README is tracked.
- GitHub Actions run 34399517969 (`dc167ec`): both jobs green.

## Manual, against real infrastructure

- Cloud SQL `iitm02:asia-south1:agrisense-db` (PostgreSQL 16.15) reached through the Auth
  Proxy; baseline plus outbox migrations applied; `alembic current` reports `7d0b0fa1bb6f`
  with no drift; 30 tables present.
- Container image built and smoke tested: `/healthz` 200, anonymous `/api/v1/fields` 401 with
  an `UNAUTHENTICATED` envelope, `/readyz` 503 with an unreachable database, process running
  as uid 10001.
- Firebase Authentication on project `iitm02` was not initialized (`CONFIGURATION_NOT_FOUND`).
  Identity Platform was initialized and the email/password provider enabled. A real ID token
  from the live project then verified; tampered, malformed and empty tokens were each refused
  with 401; enrollment from that identity produced exactly one tenant across repeated
  sign-ins. The test account was deleted.

## Not yet run

No browser session, no live weather, WhatsApp or Gemini call, and no Cloud Run revision
deployed. `META_APP_SECRET` and Gemini configuration are absent from the supplied environment,
so those capabilities remain disabled rather than partially exercised.
