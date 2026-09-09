# Phase 2 handoff

Base `contract_v1` at `ff851c3`; branch `codex/phase-2-intelligence`.

Implemented pure modules: `science/stress.py`, `water.py`, `units.py`, `economics.py` under `backend/agrisense/`. Nine arithmetic tests cover source goldens, independent FAO example, missing storage, flooded-paddy guard, money/product forms and zero yield.

The required generated-contract facade is in progress. Platform must continue returning explicit unavailable until it is delivered. Do not route around this with legacy constant weather or indicative ROI. No HTTP/auth/database files modified.

Phase 1 display goldens: cotton Tmax 35 => 4.5/9 heat index; rice frost null means unparameterized, never zero risk. 4000 kg/ha × 1 ha × INR20/kg = INR80000 revenue, INR50000 cost, INR30000 profit, 60% ROI. Zero yield yields -100% ROI when costs are positive. Missing costs => ROI null.

Live CE Hub access verified; station contract, meteoblue exported Dataset query, approved local calendars/product rules, market key and real outcome labels remain unavailable. Full browser/auth integration awaits Phase 3 runtime and merged frontend.

Milestone 2 adds internal weather types, bounded providers and window ranking. Import `agrisense.science.providers.build_weather_bundle(..., providers=...)` for dependency-injected internal bundles; the generated ForecastBundle wrapper is next. No hidden fixture provider exists in this service. Pure window engine requires reviewed evidence and full rainfast continuity.

Milestone 3 DELIVERS the generated-contract facade in `backend/agrisense/science/facade.py`. Phase 3 can now import all four exports. All pure functions accept/return the generated 1.0 models. Snapshot facts are checked for mismatched identities/future events, recommendations replay deterministically, unavailable economics remains null.

Reference scalar record convention: `planning:<crop>`, `water:<crop>`, `product:<product_id>`, `economics:<crop>`, `scenario:<crop>:<sample_id>`. Every reviewed record requires `reviewed=true`, `evidence_id` present in the evidence catalog, and ISO `valid_from`/`valid_until`. Tests contain synthetic examples only. No approved production product/calendar records are shipped.

Phase 1: null fields are present explicitly in model JSON, not omitted. `status=insufficient_data` retains null readiness/timing/viability. Water daily replenishment values are alternatives, not volumes to sum across days; contract needs dated daily water records before UI can show them authoritatively.

Milestone 4 adds `science/data.py` and `science/validation.py`, offline `science/training/train_yield.py`, source registry, rules-only model card and repeatable CPU benchmark. Run training with `PYTHONPATH=backend`; require explicit --software-test for synthetic exports. No registry promotion or remote model write occurs. Operator explicitly forbids merging other branches in this session.
