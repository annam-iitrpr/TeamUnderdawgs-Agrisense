# Phase 2 progress

Branch: `codex/phase-2-intelligence`. Shared early base: `contract_v1`, `ff851c3`.
Last verified commit: this milestone (see Git history). Full `agrisense-contract-v1` runtime bootstrap remains unpublished.

## Resumed 2026-09-10 — weather integration blocker

- Fresh clone at `e6301e3`, same Phase 2 branch; no merge or cherry-pick. Read all three supplied phase specifications. Read-only inspection of Phase 3 confirms its gateway requests 10 days near Nagpur.
- Fresh baseline: 98 tests pass. The previous session's reported 103 included uncommitted history/calibration work that is absent from origin; those files were not recovered by cloning.
- Reproduced live: 10-day CE Hub request returned 2,023 hourly measurement rows but normalized to unavailable; 2-day request succeeded. Negative solar values (-0.66/-0.37 Wh/m²) caused the whole forecast to be discarded.
- Fix preserves valid weather and rejects only invalid solar measurements to null with `provider_value_invalid`. Zero remains zero; negative/nonfinite core weather and conflicting timestamps still reject. Provider failure diagnostic codes now survive the contract bridge.
- Live facade/evaluation probe at Phase 3's location/horizon: 238 hours, 11 daily records, 30 stress points, 8 invalid solar measurements explicitly missing; structured insufficient_data, no unsupported product/value claim.
- 102 scoped tests pass, including provider → generated contract → evaluation regression and credential-safe failure diagnostics. No authenticated HTTP/browser claim.
- Next: publish this isolated fix, then restore the unfinished historical-weather slice and verification. Reviewed reference datasets and empirical model labels remain externally blocked.

| Requirement | State | Evidence / remaining work |
| --- | --- | --- |
| P2-01 weather | in-progress | Live CE Hub metadata and batched hourly probe HTTP 200; normalization and contract bridge underway |
| P2-02 references | pending | No local India crop calendars, price records, station schema or field datasets supplied |
| P2-03 algorithms | in-progress | Golden stress boundaries, separate source/advisory risk, missingness and nutrient reference arithmetic verified |
| P2-04 water | in-progress | Root-zone balance, unit conversions, unknown storage/paddy guards, FAO-56 example 18 verified |
| P2-05 suitability | pending | Requires product/crop/stage evidence catalog |
| P2-06 windows | in-progress | Internal hourly checks implemented; generated contract lacks gust/probability/inversion fields |
| P2-07 planning | pending | Build gates against supplied regional evidence; never invent local crop calendars |
| P2-08 economics | in-progress | Decimal budget, planned/actual replacement, zero-yield losses and scenario arithmetic verified |
| P2-09 learning | pending | Real labels absent; pipeline implementation remains |
| P2-10 evaluation | in-progress | First nine scientific arithmetic tests pass; integrated browser/auth runtime unavailable |

## Verified milestone 1

- `PYTHONPATH=backend python3 -m unittest discover -s backend/tests/science -p test_core.py -v`: 9 passed.
- ET0 first reproduction failed because the test transcribed Rn as 10.1 instead of 13.28. Retrieved FAO example 18 and repaired the input; published 3.88 mm/day reproduced within rounding tolerance. No production formula changed to fit a test.
- Local tools: Python 3.12.10; isolated ignored virtual environment. Shared manifests and locks left to Phase 3.
- CE Hub probe: Metadata 57 rows and batched five-variable hourly query 245 rows, both HTTP 200. Raw payloads stay under ignored `.local/cehub/`; no keys/URLs with secrets printed.
- Env remains outside checkout at `../agrisense.env`; shared `.gitignore` excludes all env/README files. Every commit runs the staged scanner against this secret file.
- Phase 1 currently has independent root ancestry, visible at `e1503f9`; Phase 2 is based on Phase 3 so their backend merge has a common ancestor. No other branch modified.

Next: publish the core arithmetic milestone; complete verified provider normalization, contract facade and honest missing-data outputs.

## Verified milestone 2

- Milestone 1 pushed as `d686c40`.
- `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/science backend/tests/test_stress.py -q`: 63 passed, including 38 inherited baseline checks.
- Bounded HTTPX transport, explicit unavailable/fallback states, CE Hub normalized measurements and Open-Meteo preceding-hour interval alignment implemented. Source times, unknown issue time, hashes, wind height and missingness retained.
- Hourly engine rejects rainfast truncation, gaps, unsafe gusts, unknown inversion, insufficient equipment duration and stale weather; supports IST half-hour UTC grids.
- CE Hub interval semantics remain unconfirmed: raw hourly input is available for diagnostics but cannot certify safe windows.
- Shared schema does not yet transport gust/probability/inversion evidence; interface request published.
- Next: implement facade against generated models and evidence-gated planning/closure.

## Verified milestone 3

- Milestone 2 pushed as `1ecb09f`.
- Public generated-contract facade exports `evaluate_season`, `compare_crops`, `summarize_season`, and async `build_weather_bundle`. Deterministic replay IDs derive from complete inputs and versions. No DB/auth/router/LLM imports.
- Paired vectorized 2,000-draw economic scenarios preserve yield/price/cost rows, expose scenario quantiles and zero-yield losses; current actual-ledger reconciliation is explicitly unavailable pending schema additions.
- Local crop planner gates reviewed date/region, soil pH, water, cash budget, historical climate coverage and remaining allocated area; never fabricates five crops.
- `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/science backend/tests/test_stress.py backend/tests/platform/test_contracts.py -q`: 74 passed. Shared tests initially could not collect because local jsonschema was absent; installed local dependency and reran successfully.
- Saved live CE Hub payload normalizes to 43 hours within the inspected UTC interval, with no synthetic weather fill.
- Full tracked-file secret scan passed against supplied env; README/environment files remain excluded.
- Next: reference ingestion, leakage-safe learning/evaluation pipeline, legacy hazard repairs and benchmark.

## Verified milestone 4

- Milestone 3 pushed as `cbbf8c1`; operator explicitly instructs **no merges with any other branch**. Continue only on Phase 2.
- Soil scale/depth interpretation, explicit market product/price units and cloud-masked NDVI transforms added; no unverified provider response maps or live satellite claim.
- Offline baseline/XGBoost pipeline, forward farmer/field-separated splitting, future-feature checks, conformal calibration, target metrics and promotion safeguards implemented.
- Baseline CLI exercised with 24 synthetic rows, 8 each train/calibration/test; result `software_test_only`. Artifacts and dataset stay in ignored `.local/`; real labels and optional XGBoost runtime remain prerequisites for empirical work.
- 81 combined science/inherited/shared-contract tests passed. NDVI exact equality initially failed at floating-point rounding; corrected to an appropriate numerical tolerance, preserving the independently expected 0.5.
- CPU window benchmark: Python 3.12.10 arm64, 336 hours/336 candidates, 50 runs; median 2.134 ms, p95 2.283 ms. Excludes network; no accuracy claim.
- Source/discrepancy registry and rules-only model card added; raw data/model binaries excluded under science/.gitignore.
- Next: inherited safety shortcuts and regression checks; no branch merge.

## Verified milestone 5

- Milestone 4 pushed as `cf6174a`. No merges performed.
- Six independent inherited-behavior regressions reproduced first: 20-billion drought index at zero temperature; nutrient index prescribing biologicals; unsupported rupee uplift; live outage falling back to demo; CE Hub missing weather receiving constants; legacy spray input certifying a window without evidence. All were then repaired.
- CE Hub and Open-Meteo legacy adapters now reject missing values rather than substituting constants; explicit zero survives. CE Hub validates duplicate timestamps and offset presence. Open-Meteo hourly aggregates aligned to preceding intervals.
- Legacy drought remains unparameterized for advisory projection; source /4 phosphorus divisor restored; nutrient diagnostics never prescribe products. Unsupported legacy incremental value returns null. Full product-safe windows use the new engine.
- `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/science backend/tests/test_stress.py backend/tests/platform/test_contracts.py -q`: 89 passed. Baseline assertions for invalid previous semantics updated with the six independent reproductions, not suppressed.
- Legacy meteoblue history defaults remain isolated from the new facade and are still a migration limitation; no live historical capability is claimed.
- Next: facade validation refinements, provider daily/history coverage and independent property tests.

## Verified milestone 6

- Milestone 5 pushed as `8c28ed7`. No merge/cherry-pick of any other branch.
- Added live CE Hub daily min/max/rain using the observed `dailyValue` schema. Daily Metadata (133 records) and three-variable daily response (9 records) both returned HTTP 200. Generic provider evapotranspiration is not treated as ET0.
- Live `probe_science_live.py`: 46 hourly, 3 daily, 6 stress points; live forecast, synthetic identity, honest `insufficient_data` recommendation. This is not an authenticated API/browser test.
- Hardened closure margin revisions, climate region/completeness, pH units, zero timing fit and delayed label availability. Added Hypothesis water scale/monotonicity properties.
- Forecast bias candidates use archived issue/valid times, QC/representativeness, observation availability cutoffs and lead bands. Mean offsets bounded, quantile mapping rejects unsupported tails; no promotion performed.
- Full scoped suite: 96 passed. Formatter/lint checks passed.
- Next: complete historical adapter/evaluation delivery and final scoped audit; platform runtime and approved scientific records remain external.

## Verified milestone 7

- Published the gateway-compatible `agrisense.science.references.reference_bundle()` factory: five crop identities, versioned unreviewed status, no fabricated parameters/products/evidence.
- Evaluation accepts weather retrieved after snapshot capture, uses the later supplied timestamp, preserves caller facts and deterministic replay.
- Current worktree suite: 103 passed, including the pending history/calibration slice. Scoped lint passed.
- Live CE Hub probe passed with natural snapshot-before-fetch ordering: 46 hours, 3 daily records, 6 stress points; recommendation remains insufficient_data. Initial sandbox attempt was unavailable; approved network rerun passed.
- Read-only coordination: Phase 3 at 956fa1c and Phase 1 at 6ba0eab; generated models differ only in import formatting. No branch merge performed.
