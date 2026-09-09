# Interface coordination

Current schema: 1.0.0, `contracts/contract_v1.md`.

## To Phase 1 — user directive

Build a full-width desktop experience with responsive tablet/mobile layouts and installable PWA support. The inherited phone-frame layout is not acceptable as the desktop website. Implement manifest, icons, service worker and offline/install UI in your owned frontend paths. Phase 3 will provide cache/security headers and hosting configuration. Acceptance: no horizontal overflow at 360/768/1280/1920px; installable manifest; authenticated content is never cached offline.

## To Phase 2 — science integration

Consume generated `SeasonSnapshot`, `ForecastBundle`, `ReferenceBundle`, `EvaluationBundle`, `PlanningSnapshot`, `ClimateBundle`, `CropComparison`, `ClosureSnapshot`, `SeasonEvaluation` from `agrisense.contracts_generated.models`. Publish facade exports and any additional reference/provider entrypoints in your interface notes. Platform must not guess science coefficients or fabricate live results.


## To Phase 1 — contract_v1 is published, replace provisional types

`contract_v1` is tagged on origin. Run `git fetch origin --tags`. The generated client types
live at `web/lib/generated/api.ts` (`Schema<"Field">`, `paths`); `web/lib/api/types.ts` on your
branch was written before publication and should be retired in favour of the generated file so
the two cannot drift.

The API is served at `/api/v1` and every route needs a Firebase bearer ID token. Every response
is `{data, meta}` and every error is `{error, request_id}`. POST requests require an
`Idempotency-Key` header of 8 to 128 characters; PATCH and confirmation requests require
`expected_version` and answer 409 `VERSION_CONFLICT` when stale. Lists are cursor-paginated
with `limit` (1 to 100) and an opaque `cursor`.

`web/package.json` and its lock file are yours. I reverted my edits to them to keep the merge
clean; please keep `firebase` pinned there.

## To Phase 2 — database access is not required

Cloud SQL is reachable locally only through `scripts/dev/cloudsql_proxy.sh`; the env file's
`DATABASE_URL` is a Cloud Run unix socket and will not work on a workstation. Your facade
consumes contract snapshots and returns pure values, so you should not need it. If you do,
run that script and point `DATABASE_URL` at `127.0.0.1:5433`.


## To Phase 2 — blocking: nothing builds a ReferenceBundle

`facade.evaluate_season(snapshot, forecast, references)` requires an
`api.ReferenceBundle`, and `references.py` only provides helpers that read one
(`reviewed_parameters`, `number`, `select_soil`). No function anywhere constructs the
bundle, so evaluation cannot run end to end.

The reviewed catalog — crops, products, evidence records and the versioned `parameters`
map — is Phase 2-owned by contract; the platform must never invent coefficients. Please
publish a builder. The gateway at `backend/agrisense/platform/science.py` already looks for
`reference_bundle()`, `reviewed_bundle()` or `build_reference_bundle()` in
`agrisense.science.references` and will pick up whichever you export, with no further change
on my side. Until then `/seasons/{id}/evaluate` dead-letters with `DEPENDENCY_UNAVAILABLE`,
which is the intended honest behaviour rather than a fabricated result.

Two smaller notes:

- `build_weather_bundle` reads `CEHUB_API_KEY` / `CEHUB_BEARER_TOKEN` from `os.getenv`
  directly. Deployed services receive configuration through `agrisense.config.Settings`; a
  process-level env read still works on Cloud Run, but the credentials will not appear in
  the settings validation or the deployment guards. Consider accepting the values as
  arguments so the caller supplies them.
- The facade raises `ValueError` when `forecast.retrieved_at > snapshot.as_of`. The gateway
  builds the snapshot first and then fetches the forecast, so the fetch is always the later
  timestamp. I pass the same `as_of` to both to satisfy this; if you intend a different
  ordering rule, say so and I will reshape the call rather than work around it.
