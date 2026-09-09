# contract_v1 — integration handoff

Version: 1.0.0. Owner: `codex/phase-3-platform`.

This is the early interface publication requested by the user. It is **not** the completed P3-00 bootstrap gate. The tested `agrisense-contract-v1` tag is reserved until PostgreSQL, Firebase email/password browser authentication, enrollment, and the science harness pass. Do not mistake schema fixtures for live service results.

- HTTP authority: `contracts/openapi.yaml` (OpenAPI 3.1; JSON is valid YAML).
- Science authority: `contracts/science.schema.json`.
- Events authority: `contracts/events.schema.json`.
- Python imports: `agrisense.contracts_generated.models`.
- TypeScript imports: `web/lib/generated/api.ts`, `Schema<"Field">`, `paths`.
- Author changes in `contracts/models.py` / `contracts/routes.py`, run `backend/.venv/bin/python scripts/generate_contracts.py`; never edit generated bindings separately.
- IDs are strings; body identity/tenant/role fields are forbidden. `/api/v1`, Firebase bearer ID token, actor-scoped `Idempotency-Key` for POSTs, and `expected_version` for PATCH/confirmation/close. Every response is `{data,meta}`; every error is `{error,request_id}`.
- `Envelope[Page[T]]` lists use bounded `limit` and opaque `cursor`; unknown measurements have null values and reasons.
- UTC aware ISO timestamps; local dates and `Asia/Kolkata`; intervals `[start_at,end_at)`.
- Fields contain `centroid: {latitude,longitude,source,...}`; seasons have `allocated_area_ha`; field total area must never be reused for each simultaneous crop.

## Phase 2 integration

Implement only pure exports in `backend/agrisense/science/facade.py`:

```python
from agrisense.contracts_generated.models import (
    SeasonSnapshot, ForecastBundle, ReferenceBundle, EvaluationBundle,
    PlanningSnapshot, ClimateBundle, CropComparison, ClosureSnapshot, SeasonEvaluation,
)

def evaluate_season(snapshot: SeasonSnapshot, forecast: ForecastBundle,
                    references: ReferenceBundle) -> EvaluationBundle: ...
def compare_crops(snapshot: PlanningSnapshot, references: ReferenceBundle,
                  climate: ClimateBundle) -> CropComparison: ...
def summarize_season(snapshot: ClosureSnapshot) -> SeasonEvaluation: ...
```

Async weather adapter: `build_weather_bundle(location, horizon, as_of) -> ForecastBundle`.
Science returns proposed tasks; platform alone persists them. Reference coefficients remain Phase 2-owned. Request additional types/fields in `workstreams/phase-2/interface-requests.md`; do not fork schemas. Platform will initially return explicit dependency-unavailable until the facade is delivered.

## Phase 1 integration and current user requirements

User explicitly requires a professional **full-width desktop website**, responsive on every screen size, with an installable **PWA**. Replace the inherited phone-frame composition in Phase 1. Do not constrain desktop pages to a phone canvas. Test 360px, 768px, 1280px, and 1920px, keyboard navigation, and horizontal overflow. Phase 1 owns manifest/icons/service-worker UI and install affordance; Phase 3 owns security/cache headers and hosting support. Cache public shell assets only; authenticated API responses, Firebase tokens, private media and personal farmer content must not enter shared/offline caches. Display an honest offline state.

## Shared source and branch discipline

The destination repository was empty at inspection. Baseline source is imported from `AkashaPrasad/AgriSense-AnnamAI` at `b94a311e9daeeb6247dd2eb5c36647fda03cc9dd`, without README/environment files or unrelated historical objects. All streams should share this initial commit ancestry, not independently reimport the app. Phase 3 owns manifests/locks, contracts, generated code, platform backend, infra and scripts. Phase 1 owns frontend UI. Phase 2 owns agronomy/clients/science. Never force-push another stream or merge unverified streams into the default branch.
