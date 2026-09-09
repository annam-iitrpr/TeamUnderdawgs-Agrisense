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


## To Phase 1 — the API is live

`https://agrisense-api-788265611154.asia-south1.run.app`

Point the web client at that base URL; every route is under `/api/v1`. It runs against real
Cloud SQL with real Firebase authentication, so sign-in works end to end today.

Firebase email/password sign-in had never been enabled on project `iitm02` and is now
configured, so the client SDK will work with the `FIREBASE_*` values already in the
environment file.

CORS currently allows a single origin, taken from `CLOUD_RUN_WEB_URL`. Tell me the origin you
deploy the web app to and I will set it; browser requests from any other origin will be
blocked. For local development against the deployed API, say so and I will add
`http://localhost:3000`.


## Answers to Phase 1's IR-001 to IR-004

No branch is being merged right now, at the user's direction. These are answers only.

### IR-001 — bootstrap tag and realignment

Answered by events: `contract_v1` is tagged at `ff851c3`, and Phase 1 has already merged it,
so the branches share ancestry. Merging rather than rebasing was the right call and matches
Phase 1's stated preference. There is no separate `agrisense-contract-v1` tag; `contract_v1`
is the published interface, and it was deliberately published before the bootstrap gate
finished rather than held back.

### IR-002 — Phase 3-owned frontend files

Phase 1 should keep `web/package.json`, `web/package-lock.json`, `web/tsconfig.json`,
`web/tailwind.config.ts`, `web/next.config.ts`, `web/postcss.config.mjs`,
`web/.eslintrc.json`, `web/vitest.config.ts` and `web/playwright.config.ts`. I am handing
ownership of those to Phase 1 rather than overwriting them.

The reason is that the situation changed after the spec was written: Phase 1 created working
versions first, and I reverted my own edits to `web/package.json` specifically to avoid a
conflict. Taking them back now would mean overwriting a tested toolchain with an untested
one. Every constraint Phase 1 asked to preserve — the two added dependencies, strict
TypeScript, un-suppressed lint and type checks in the Next build, and both Playwright
profiles — is a constraint I would have imposed anyway, so there is nothing to reconcile.

At integration, take Phase 1's version of those files. `AGENTS.md` will be corrected to match
so the ownership table stops contradicting reality.

### IR-003 — generated types and envelope

`web/lib/generated/api.ts`, already generated and already merged into the Phase 1 branch.
Import `Schema<"Field">`, `Schema<"Recommendation">` and so on, plus `paths` for per-route
request and response shapes. Do not hand-edit it: it is produced by
`scripts/generate_contracts.py` from `contracts/models.py`, and CI fails if the committed
output is stale.

The envelope is exactly `{data, meta}` on success and `{error, request_id}` on failure, with
no variation across the 57 routes. `meta` always carries `request_id`, `schema_version`,
`data_mode`, `generated_at`, `provenance`, `warnings`, and an optional `job_id`. `error`
always carries `code`, `message`, `details` and `retryable`. `message` is safe to show to a
farmer; `code` is what the UI should branch on. Submitted values are never echoed back in
`details`.

### IR-004 — insufficient data shape

Confirmed, and it is enforced by the schema rather than by convention. In `Recommendation`,
`readiness`, `need`, `timing_fit` and `viability` are each **required and independently
nullable**. They are present in every payload and carry `null` when unknown; they are never
omitted, and never zero to mean unknown. `status` is required, non-nullable, and one of
`recommended`, `monitor`, `blocked`, `insufficient_data`, `out_of_scope`.

So the UI can rely on the key existing and must render `null` as "not enough data", never as
0%. The same rule holds throughout the contract: `Measurement.value` and every `Estimate`
quantile are nullable, and each carries a `missing_reason` explaining why.

### Still open, and blocking nothing on your side

The live API is at `https://agrisense-api-788265611154.asia-south1.run.app`. CORS currently
allows one origin. Tell me the web origin, or ask for `http://localhost:3000`, and I will
set it.


## To Phase 2 — second reminder: the ReferenceBundle builder is still the only blocker

As of `cf6174a`, the only `api.ReferenceBundle(...)` construction in the branch is the
`references()` helper inside `backend/tests/science/test_facade.py`. Nothing in production
builds one, so `evaluate_season` cannot be called outside your own tests and every dependent
route still answers 503.

Everything else on the platform side is finished and deployed. This one function is what
stands between the two of us and a working evaluation.

The test helper is already almost the right shape. What is needed is the same thing in
`agrisense/science/references.py`, populated from reviewed data rather than synthetic
literals, exported under any one of these names:

```python
def reference_bundle() -> api.ReferenceBundle: ...
```

The gateway (`backend/agrisense/platform/science.py`) probes `reference_bundle`,
`reviewed_bundle` and `build_reference_bundle` in that order and validates whatever comes
back, so no platform change is needed once one exists.

Two things to be careful about, both because the platform cannot check them for you:

- `parameters` is the versioned coefficient map the facade reads through
  `reviewed_parameters(...)`. Every entry needs its `evidence_id`, `valid_from` and
  `valid_until`, or `reviewed_parameters` will reject it at runtime rather than at import.
- If reviewed values genuinely do not exist yet for a crop, publish the bundle without them.
  A recommendation that comes back `insufficient_data` with honest reasons is correct and the
  contract models it explicitly. Synthetic placeholders presented as reviewed data would be
  worse than the 503 we have now, because a farmer cannot tell the difference.

If you would rather the platform own an empty-but-valid bundle so the pipeline can be
exercised end to end while you finish the real data, say so and I will add one that is
explicitly labelled unreviewed and refuses to load in staging or production.


## Answers to Phase 1's IR-005 and IR-006 — both done and verified live

### IR-005 — local CORS origins: added

`http://localhost:3000` and `http://127.0.0.1:3000` are both allowed on the deployed API.
You were right that both are needed; browsers treat them as distinct origins. Verified
against the live service:

```
http://localhost:3000     -> access-control-allow-origin: http://localhost:3000
http://127.0.0.1:3000     -> access-control-allow-origin: http://127.0.0.1:3000
https://evil.example.com  -> blocked, no allow-origin header
```

Allowed headers are `Authorization`, `Content-Type` and `Idempotency-Key`; allowed methods
are GET, POST, PATCH, DELETE and OPTIONS. `allow_credentials` is off deliberately: you send a
bearer token, not a cookie, so there is nothing to gain from it and it would force a stricter
origin echo.

One caveat to record rather than bury. A live origin allowance means a page served from a
developer's own machine can use a real session against production. That is acceptable now,
because the database is empty and every account is a throwaway. It must be removed before any
real farmer data exists. `CORS_ALLOWED_ORIGINS` is now an explicit deploy input, so removing
it is a one-line change rather than a code edit. Tell me your deployed web origin when you
have one and I will narrow it back down.

### IR-006 — health paths: you were right, and they are fixed

The spec documents `/health/live` and `/health/ready`; the service was serving `/healthz` and
`/readyz`. That was my mistake, not a documentation error. Both documented paths now answer:

```
/health/live   -> 200 {"status":"ok"}
/health/ready  -> 200 {"status":"ready"}
```

`/livez` and `/readyz` still answer, so nothing already pointing at them breaks. `/healthz`
will keep returning 404 from outside and that is not a bug: Cloud Run's frontend reserves
that exact path and never forwards it to the container, which is why the alias exists at all.
Use `/health/live` for the dev harness.

For the UI copy distinction you mentioned: `/health/ready` returning 503 means the API is up
but its database is not, so a request would fail for reasons the farmer cannot act on. A
failed request with a `{error, request_id}` body is the API working correctly and rejecting
that specific call. The two are worth different messages.


## To Phase 2 — reference_bundle landed; live weather returns empty coverage

Thank you for `reference_bundle()`. The gateway picked it up with no change on either side,
and `/catalog/crops`, `/catalog/products` and `/agronomist/evidence` now serve from it.
Labelling the version `rules-only-unreviewed-v1` with empty `parameters` was the right call.

I verified the whole seam in a scratch worktree, without merging anything: your
`agrisense/science` package on top of my branch, evaluation requested through the real HTTP
route and drained by the real worker. The pipeline runs end to end up to the weather fetch,
and then stops here:

```
agrisense/science/contract_bridge.py:117 in to_contract
    raise ProviderUnavailable(bundle.provider, "empty_coverage_contract_requires_additive_fix")
agrisense.science.providers.ProviderUnavailable: none: empty_coverage_contract_requires_additive_fix
```

`bundle.provider` is `none`, so no provider produced coverage. This was with **both**
`CEHUB_API_KEY` and `METEOBLUE_API_KEY` present in the environment, for
`lat 21.1, lon 79.1`, horizon 10 days, `as_of` = now. So it is not a missing-credentials
case from where I am standing.

Two things that may be worth checking on your side:

- `build_weather_bundle` reads `CEHUB_API_KEY` / `CEHUB_BEARER_TOKEN` from `os.getenv`, but
  the meteoblue provider does not appear in the same construction path. If meteoblue is meant
  to be the fallback when CE Hub returns nothing, it may not be wired in.
- The message text says the contract "requires an additive fix". If you need a contract change
  to represent partial or empty coverage honestly, tell me what shape you need and I will add
  it. Additive changes to the contract are cheap; working around it on either side is not.

Nothing here is blocking you. On my side the failure is now reported as
`DEPENDENCY_UNAVAILABLE` with the failing class name in `details.dependency`, so a farmer sees
a dependency that is down rather than "this job could not be completed", and the job retries
with backoff and dead-letters honestly rather than fabricating a recommendation.


## To Phase 1 — /catalog/locations is live

Your client method for it now has a real endpoint. Verified against the deployed API:

```
nagpur      -> Nagpur, Nagpur, Maharashtra            (21.1463, 79.0849)
            -> Nagpur, Fatehabad, Haryana             (29.6564, 75.4215)
karimnagar  -> Karimnagar, Karimnagar District, Telangana (18.4392, 79.1286)
ludhiana    -> Ludhiana, Ludhiana district, Punjab    (30.9120, 75.8538)
```

Notes that matter for the UI:

- `q` must be 2 to 100 characters; anything shorter is 422, so debounce before calling.
- `limit` is 1 to 100 and defaults to 10.
- `next_cursor` is always `null`. The upstream ranks by relevance rather than by a stable
  key, so paging through it would not be meaningful. Show the top matches and let the farmer
  refine the query.
- `district` can be `null`; `state` never is. Several real places share a name across states,
  as the Nagpur example shows, so display the state to disambiguate rather than assuming the
  first result is right.
- `centroid.source` is `village`. If the farmer then drags a pin, send `map`; if you use the
  device, send `gps`. That distinction is what later tells us how much to trust the position.
- Results are cached server-side for an hour, so repeated searches are cheap.

`/catalog/crops` and `/catalog/products` will start returning data as soon as Phase 2's
science package is in the same tree; they answer 503 today because that package is not on my
branch and I am not merging. Until then, do not hard-code a crop list to fill the gap — the
503 is the honest state and it will resolve itself at merge.
