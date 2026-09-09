# Phase 2 interface requests

## Resolved: Phase 3 ten-day weather blocker (2026-09-10)

Reproduced your latitude 21.1 / longitude 79.1 / horizon 10 case. CE Hub returns populated weather, but negative solar energy values made the strict normalizer reject the entire series. Phase 2 now preserves the valid weather and marks invalid solar values null with a per-measurement reason. Live facade → evaluation passed with 238 hourly records, 11 daily records and 30 stress points. Results correctly remain insufficient_data when reviewed agronomic records are absent. No contract/platform edits needed for this defect; integrate only when the operator authorizes integration.

`METEOBLUE_API_KEY` supplies historical Dataset reanalysis, not a verified forecast fallback. Do not wire history into operational future forecasts. The separate null-coverage schema request below still applies to genuine provider outages; the exception now exposes safe `diagnostics` codes (no provider response bodies/URLs) so operators can distinguish auth/schema/transport failures.

## Separate platform gap: planning route remains a stub

Read-only inspection of `origin/codex/phase-3-platform:backend/agrisense/platform/service.py`, `/planning/compare` branch, shows `self.own(...); raise unavailable('Crop planning science integration')`. This route never calls Phase 2 `compare_crops`. Wire an authorized PlanningSnapshot and historical ClimateBundle to the existing facade; never use a ten-day future forecast as full-season climate. Acceptance: missing reviewed local evidence returns a structured CropComparison with exclusions, not unconditional 503. Approved regional data remains absent; do not substitute synthetic planner test records.

Historical data entrypoint is now available in `agrisense.science.history.MeteoblueHistoryProvider`. Its typed daily output preserves missingness and explicitly identifies reanalysis; platform must cache/archive and orchestrate large/queued imports. It does not itself construct approved regional planning parameters or validated climate ensembles.

Current schema: `contract_v1` / 1.0 from `ff851c3`. Phase 3 owns additive changes and regeneration.

1. Add optional `gust_kmh: Measurement`, `rain_probability: Measurement` (fraction), and `inversion_clear: bool|null` with dated evidence to `ForecastHour`. Example: `{"gust_kmh":{"value":12,"unit":"km/h"},"rain_probability":{"value":0.1,"unit":"fraction"},"inversion_clear":null}`. Missing inversion must require field verification. Acceptance: a gust/rain-probability prohibition or unknown inversion cannot yield an unconditional selected interval.
2. Forecast coverage is currently required even for unavailable/empty data. Permit null coverage when `data_mode=unavailable`; `Location.source` also needs a provider-grid provenance value. Never invent coverage or describe requested coordinates as actual grid cells.
3. Cost ledger needs planned/actual basis, category/line identity, revision, currency paise/decimal and completeness. Current `{id,amount,unit,kind}` cannot replace planned lines or certify final season cost. Need validated yield/price/product-form scenarios and selected product/equipment fields in snapshots. Until added, science exposes null authoritative ROI when required evidence is missing.
4. Reference parameters currently allow only scalar flat values. Phase 2 can encode named regional/product scalar records under parameter keys, but paired historical scenarios and applicability polygons need typed records. Proposed additive `scenario_records` with sample/year, crop/product form, yield kg/ha, price INR/kg, cost INR/ha and provenance. Acceptance: R1/R2 preserve yield-price-cost dependencies and local crop applicability.
5. ClosureSnapshot includes recommendations but no immutable economics/yield forecasts. Add forecast estimates with vintage/area/product form for signed error, MAE, interval coverage and zero-denominator handling. Current facade can report actual margin without inventing a comparison forecast.
6. Shared dependency request: retain `httpx`, `numpy`, `pydantic`, pytest/Hypothesis/ruff; optional offline XGBoost/NumPyro extras should be platform-pinned. Persistent cache port and authentication/browser harness remain pending.

Integration ancestry: Phase 1 began at independent root `8284943`; Phase 2 starts from Phase 3's `ff851c3`. Integrator should coordinate Phase 1 realignment; no force-push or unrelated-history merge was performed here.

## Response to Phase 3 reference and timestamp requests

Delivered `agrisense.science.references.reference_bundle()` with no required arguments and generated-v1 return type. Default contains catalog identities only; every reviewed parameter remains absent. The natural capture-then-fetch sequence is accepted and verified with live CE Hub. Platform can use its existing dynamic loader unchanged after integration. No branch merges performed.
