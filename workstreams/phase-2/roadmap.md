# Phase 2 resumed implementation assessment — 2026-09-10

All three supplied phase specifications were read before source edits. Current operator authorization is implementation on `codex/phase-2-intelligence`, with milestone pushes, no merges and no README/environment publication. Base `contract_v1` is `ff851c3`; resumed checkout was `e6301e3`. This assessment supersedes the early pending labels in the chronological progress ledger.

## Architecture and ownership

The phases are parallel ownership streams after shared contracts, not serial releases. Phase 1 owns farmer/agronomist web flows, consumes authenticated envelopes and displays science states. Phase 3 owns identity/tenancy, transactional PostgreSQL records, immutable snapshots, API/worker orchestration, notifications, media, Gemini/WhatsApp and deployment. Phase 2 owns normalized providers and deterministic science. Provider IO sits outside pure evaluation; no science function queries SQL or delegates numbers to Gemini. Forecast data, regional historical climate, field observations and approved reference parameters have separate meanings.

Dependency order: shared generated contracts → authorized field/season facts and reference/provider inputs → pure science evaluation → platform persistence/jobs → UI/channel display and confirmed journal actions → refreshed evaluation → closure/outcome curation → offline validation → authorized model promotion. Heavy training and remote data retrieval stay outside pure request-time computation.

## Existing state and remaining files

| Requirement | Implemented / verified | Partial or missing | Phase 2 paths |
| --- | --- | --- | --- |
| P2-01 providers | CE Hub hourly/daily; Open-Meteo explicit fallback; bounded transport; 10-day solar regression fixed; typed meteoblue history live checked | CE interval semantics, persistent cache/archive integration, station contract; queued history orchestration | `backend/agrisense/science/providers.py`, `weather.py`, `history.py`, `contract_bridge.py`; `backend/tests/science/test_providers.py`, `test_history.py`, `test_weather_seam.py` |
| P2-02 data | Soil/market/NDVI unit and quality transforms, catalog identity loader | Reviewed regional crop/soil/product/price records, live market/station/satellite schemas and datasets | `backend/agrisense/science/data.py`, `references.py`; `science/reference/`; future reviewed source-specific loaders and matching tests |
| P2-03 algorithms | Source/advisory distinctions, stress boundaries and nutrient diagnostics | Agronomist-approved parameters and regional GDD/stage inputs | `backend/agrisense/science/stress.py`; `backend/agrisense/agronomy/`; `science/reference/sources.json` |
| P2-04 water | FAO example, root-zone balance, area/unit properties; missing storage and paddy guards | Flooded-paddy/AWD management model with reviewed parameters; dated daily water contract; CE ET0 equivalence unverified | `backend/agrisense/science/water.py`, `facade.py`; science tests |
| P2-05/06 suitability/windows | Product/stage gates; hourly continuity, rainfast after spray end, gust/inversion/equipment checks; deterministic readiness | Approved label catalog; generated contract lacks gust/probability/inversion and equipment/product details | `backend/agrisense/science/windows.py`, `facade.py`, `references.py`; `backend/tests/science/test_windows.py` |
| P2-07 planning | Local reference gates, remaining area, water/budget/soil/climate checks, fewer than five candidates | Reviewed crop calendars, full climate ensembles, richer preference/variety inputs; platform route not wired | `backend/agrisense/science/planning.py`, `references.py`; science planner tests |
| P2-08 economics | Decimal budget arithmetic, paired scenarios, ROI and losses, closure margin correction | Actual/planned ledger bridge and dated price/product records; causal application effect unavailable | `backend/agrisense/science/economics.py`, `scenarios.py`, `facade.py` |
| P2-09 learning | Forward farmer/field separation, label availability gates, baseline/XGBoost CLI, conformal metrics, shadow weather bias and promotion guard | Real labels, optional runtime execution, hierarchical NumPyro/SHAP pipeline, subgroup evaluations and reviewed approval thresholds | `backend/agrisense/science/validation.py`, `bias.py`; `science/training/train_yield.py`; future optional training/evaluation modules |
| P2-10 verification | 109 scoped tests; live provider/science checks; window and generated-facade CPU benchmarks | Authenticated browser/API/worker tests, empirical feasible-window and yield/price evaluations | `backend/tests/science/`; `science/evaluation/`; future `web/tests/e2e/phase2/` tests against shared runtime |

No trained model or reviewed farmer recommendation is claimed. A passing arithmetic/software fixture does not satisfy empirical validation. Default references remain `rules-only-unreviewed-v1` with no approved coefficients/products.

## Next implementation order

1. **Delivered first:** fix CE Hub long-horizon forecast loss and publish regression/live evidence (`d04e2ac`). Phase 3 can consume the fix when integration is authorized.
2. **Delivered:** typed historical reanalysis and legacy missingness repair (`2d29b01`). Platform should persist/cache dated daily history and handle queued/large imports separately from evaluations.
3. **Delivered in this verification slice:** reproducible full-facade and five-crop benchmark, complementing the existing hourly ranking benchmark. Synthetic-only fixture construction stays outside production loaders.
4. **Contract coordination:** Phase 3 supplies additive weather safety, nullable outage coverage, dated water, planned/actual cost/revision, closure forecast-vintage and structured regional scenario fields. Phase 2 then updates `contract_bridge.py`, `facade.py`, `scenarios.py` and contract regression tests. Do not independently modify generated files.
5. **Reference/data onboarding:** ingest legitimate region/variety calendars, water/phenology parameters, product labels and paired yield/price/cost data with version/hash/review status. Populate `science/reference/` and loaders only from actual supplied/retrieved evidence; keep raw data ignored. Complete paddy/seasonal climate features against these parameters.
6. **Planning and API integration:** Phase 3 replaces its unconditional planning 503 with authorized snapshot/climate orchestration and runs real HTTP/worker checks. Phase 1 consumes structured exclusions/nulls and fresh forecast outputs. No implementation in other owners' files here.
7. **Offline model completion:** add optional hierarchical/quantile/SHAP jobs and subgroup reports once source schemas, dependencies and review criteria are agreed; run baseline and candidate validation on consented outcomes. Synthetic fixtures may verify execution only. No automatic promotion.
8. **Owned browser acceptance:** add Phase 2 Playwright journeys to shared authenticated harness and then integrated UI; verify null/zero, rain blocks, units, provider outages, tenant denial and closure. Current branch has no runnable shared auth harness; do not create a bypass.
9. **Release gate:** owners coordinate eventual integration and staging tests only after the operator lifts the no-merge instruction. Do not publish or mutate deployed services as a substitute for branch delivery.

## Conflicts and integration facts

- Only the early `contract_v1` tag exists in this checkout; full runtime bootstrap is not demonstrated on Phase 2. The user explicitly authorizes continuing without merges.
- The preceding session's 103-test report included work not pushed to origin; the fresh clone had 98 passing tests. No claim that cloning restored uncommitted files.
- Phase 3's reported weather blocker was real, but its `/planning/compare` route has an independent unconditional unavailable branch. Weather repair alone cannot fix that endpoint.
- Legacy `DailyWeather` can now carry unknown rain/humidity/wind/radiation. Consumers that sum legacy history need completeness checks; the new typed history/science path preserves missingness. Phase 3 owns legacy API consumers and must not convert nulls to zero.
- Public snapshots lack several scientific inputs named in the specs. Detailed additive requests are in `interface-requests.md`; unsafe inferred values are not a compatible substitute.
- The planning implementation uses reviewed scalar seasonal requirements and duration intervals; it is not yet the specified full historical climate ensemble/variety model. Its benchmark is performance evidence only.
- meteoblue reanalysis has no archived issue-time forecast skill. It cannot validate live forecast calibration by itself.
- Default reference identities are not approved product advice; water/economics may remain unknown after HTTP evaluation succeeds. No production-safe spray window can be certified while required evidence is missing.
- README and env patterns already exist in shared `.gitignore`; no root ignore edit or README deletion needed. Raw data/model artifacts stay ignored. Every milestone is staged explicitly and scanned against the local secret file.
