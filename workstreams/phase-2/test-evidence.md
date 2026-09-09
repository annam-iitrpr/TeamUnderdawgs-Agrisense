# Phase 2 test evidence

All numeric fixtures are synthetic arithmetic inputs, not empirical field evidence.

2026-09-10 resumed checkout: baseline 98 passed. New solar regression failed first at `radiation_wm2` for -0.66. After scoped normalization fix: `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/science backend/tests/test_stress.py backend/tests/platform/test_contracts.py -q` → 102 passed. Live `probe_science_live.py --env ../agrisense.env` → passed, 10-day Nagpur case, 238 hours/11 daily/30 stress points/8 invalid solar values left null. Pure seam test includes HTTPX provider boundary, real generated models and real evaluation; HTTP route, worker and auth are not exercised. Fresh Python 3.12 local venv uses existing manifest; no dependency manifest/lock changes.

Milestone 1: Python 3.12.10, `PYTHONPATH=backend python3 -m unittest discover -s backend/tests/science -p test_core.py -v`, 9 passed. Source boundary, monotonicity, nonfinite/missing, water balance, unit conversion, FAO reference, decimal economics, zero yield and duplicate/revised cost coverage.

Independent ET0 source: https://www.fao.org/4/x0490e/x0490e08.htm, example 18, Rn=13.28 MJ/m²/day and published ET0=3.88 mm/day. Initial fixture transcription failure corrected and rerun successfully.

Not run: authenticated API, PostgreSQL integration, Playwright and hosted staging. These require the shared runtime; unit checks do not substitute for them.

Milestone 2: combined science and inherited stress suite, 63 passed in 1.30 seconds. HTTPX mock boundaries cover 204, 401/403, redirects, circuit opening, retry-after, oversized payload and redaction. Live probe success is separate from fixture tests.

Open-Meteo official hourly definitions (https://open-meteo.com/en/docs) identify rain, probability, gusts and radiation as preceding-hour aggregates. Normalizer shifts these to interval starts; terminal unknown stays null. CE Hub UTC offset and 2 m wind height observed live; modelUpdateTime timezone and sum interval convention remain unresolved.

Milestone 3: 74 tests passed including six shared contract checks. Added deterministic generated-model round-trip, foreign snapshot rejection, unit mismatch rejection, paired ROI scenario, fewer-than-five crop comparison, water budget exclusion, closure zero yield/cost. JSON Schema dependency installed only in local venv. No browser test claim.

Milestone 4: 81 passed. Baseline training CLI ran on 24 explicit synthetic rows and emitted software-test-only evaluation with 8 independent rows per split. NDVI, market price forms, crop-product mismatch, grouped temporal leakage, zero-outcome metrics and synthetic promotion denial tested.

`PYTHONPATH=backend .venv/bin/python science/evaluation/benchmark.py`: synthetic 336-hour/336-candidate window engine, 50 runs on arm64/Python 3.12.10, p95 2.283 ms; no network/DB/LLM. Optional XGBoost fit has not been run; no empirical model evaluation exists.

Milestone 5: initial `test_legacy_guards.py` run produced six expected failures identifying actual inherited defects. After fixes, full scoped suite is 89 passed. Added explicit mock/no-network and missing-vs-zero Open-Meteo tests. Restored source /4 phosphorus and null zero-temperature behavior in inherited tests, with rationale tied to source discrepancies.

Milestone 6: 96 passed, including water Hypothesis properties, CE daily normalization, zero timing rejection, late-label leakage and forecast bias constraints. Live generated-contract bridge plus pure facade succeeded with 46 hours, 3 daily records, 6 stress points; product recommendation remained insufficient_data. No private identity or raw API payload committed.
