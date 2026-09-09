# Phase 2 progress

Branch: `codex/phase-2-intelligence`. Shared early base: `contract_v1`, `ff851c3`.
Last verified commit: this milestone (see Git history). Full `agrisense-contract-v1` runtime bootstrap remains unpublished.

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
