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

## Deployed and verified in production

Cloud Run service `agrisense-api` in `asia-south1`, running as a dedicated least-privilege
service account, reaching Cloud SQL over the attached socket, with `DATABASE_URL` and the
media signing secret read from Secret Manager.

Live URL: https://agrisense-api-788265611154.asia-south1.run.app

Verified against the deployed service with a real Firebase account created and then deleted:

1. `GET /livez` and `GET /readyz` answer 200; readiness proves the Cloud SQL connection.
2. Anonymous `/api/v1/*` is refused 401 with the contract error envelope.
3. Security headers present: HSTS, `nosniff`, `DENY`, `no-referrer`, `no-store`, request id.
4. A real Firebase ID token enrolls on first call and returns the profile at version 1.
5. A field persists to Cloud SQL and a replayed `Idempotency-Key` returns the same record.
6. Over-allocating a season is refused 422 `AREA_ALLOCATION_EXCEEDED`.
7. A stale `expected_version` is refused 409 `VERSION_CONFLICT`.
8. `/seasons/{id}/water` answers 503 `DEPENDENCY_UNAVAILABLE` rather than inventing a number.

All rows created by that run were deleted afterwards; the shared database is back to empty.

## Worker verified in production

Deployed as a Cloud Run job invoked every minute by Cloud Scheduler through a dedicated
invoker identity, running the same image as the API.

- A pass connects to Cloud SQL, drains what is queued and exits zero; a quiet pass is normal.
- An account export was queued through the deployed API, picked up by the **scheduled** worker
  with no manual trigger, and succeeded on its first attempt.
- The resulting file was downloaded through a signed link and contained the farmer's own
  records.
- An erasure was queued the same way, ran on the schedule, and removed the records and the
  stored objects. The bucket is empty and the database is back to zero rows.

Two real defects were found only by running this against real infrastructure, not by
inspection or by the offline suite:

1. Signed media links failed with `DEPENDENCY_UNAVAILABLE`, because Cloud Run's metadata
   credential carries no private key. Signing now goes through the IAM signBlob API.
2. The erasure job deletes its own job row, which the worker then wrote a status to. The job
   row references the tenant being erased and cannot outlive it, so the disappearance is now
   explicit and covered by a test.

## Throttling and location search verified in production

- An unauthenticated flood against the deployed API returned 119 x 401 and then 429 with
  `Retry-After: 60`, so the guard fires before a request costs a token verification.
- `/catalog/locations` returned real Indian places with district, state and coordinates for
  nagpur, karimnagar and ludhiana; a one-character query was refused 422.
- `/catalog/crops` answers 503 on this branch because the Phase 2 package is not in the tree.
  That is the intended honest state and resolves at merge.

## Science integration verified without merging

Phase 2's `agrisense/science` package was checked out into a scratch worktree on top of this
branch, and an evaluation was requested through the real HTTP route and drained by the real
worker. The seam works: the gateway resolved their facade and `reference_bundle()` with no
change on either side. The pipeline runs to the weather fetch and stops there with
`ProviderUnavailable: none: empty_coverage_contract_requires_additive_fix`, with both CE Hub
and meteoblue keys present. Reported to Phase 2; the worktree was removed and nothing merged.

## WhatsApp verified in production

`META_APP_SECRET` was supplied, so inbound ingestion is live. The access token was validated
against the Graph API first: a Meta sandbox test number, quality rating GREEN. All three
secrets are read from Secret Manager.

Against the deployed webhook:

| Case | Result |
|---|---|
| Subscription verification with the configured token | 200, challenge echoed |
| Subscription verification with a wrong token | 403 |
| Correctly signed delivery | 200 |
| Unsigned delivery | 403 |
| Delivery with a forged signature | 403 |
| The same message id delivered three times | one stored row |

The stored row contains `from_hash` and no phone number. The sender was not linked to any
account, so no channel was created and no job was queued: an unknown sender is never guessed
into an account. The test row was deleted afterwards.

Outbound remains in outbox mode. Nothing has been sent to anyone.

## Not yet run

No browser session, no live weather or Gemini call, and no outbound WhatsApp message, and no Cloud Run revision
deployed. Gemini configuration is still absent, so the assistant and soil extraction remain disabled
rather than partially exercised.
