# Phase 2 handoff

Base `contract_v1` at `ff851c3`; branch `codex/phase-2-intelligence`.

Latest integration fix (2026-09-10): the 10-day Nagpur empty-coverage failure was caused by negative CE Hub radiation values invalidating all weather. Invalid solar values now remain null with `provider_value_invalid`; valid temperature/rain/wind/daily series survive. Live generated-facade evaluation passed with 238 hours and 30 stress points. No platform/schema changes are needed for this fix. No branches merged. `probe_science_live.py --env ../agrisense.env` now defaults to the reported 10-day/Nagpur case. A passed probe is a provider/science check with synthetic identity, not authenticated endpoint verification.

Historical port: `agrisense.science.history.MeteoblueHistoryProvider(transport, api_key=...).history((lat, lon), start_date, end_date, as_of)` returns an internal `WeatherBundle` with daily reanalysis only, mode estimated, no forecast vintage, no ET0. Calls are bounded to 366 days inclusive and past dates. A queued response raises `history_job_requires_platform_worker`; durable historical imports need platform orchestration. Verified live for 2026-08-01 through 2026-08-03. The existing ERA5T/ERA5 query is retained, not a newly guessed product. No local calendar or yield/product evidence is supplied by this weather result.

Implemented pure modules: `science/stress.py`, `water.py`, `units.py`, `economics.py` under `backend/agrisense/`. Nine arithmetic tests cover source goldens, independent FAO example, missing storage, flooded-paddy guard, money/product forms and zero yield.

The required generated-contract facade is in progress. Platform must continue returning explicit unavailable until it is delivered. Do not route around this with legacy constant weather or indicative ROI. No HTTP/auth/database files modified.

Phase 1 display goldens: cotton Tmax 35 => 4.5/9 heat index; rice frost null means unparameterized, never zero risk. 4000 kg/ha × 1 ha × INR20/kg = INR80000 revenue, INR50000 cost, INR30000 profit, 60% ROI. Zero yield yields -100% ROI when costs are positive. Missing costs => ROI null.

Live CE Hub access verified; station contract, meteoblue exported Dataset query, approved local calendars/product rules, market key and real outcome labels remain unavailable. Full browser/auth integration awaits Phase 3 runtime and merged frontend.

Milestone 2 adds internal weather types, bounded providers and window ranking. Import `agrisense.science.providers.build_weather_bundle(..., providers=...)` for dependency-injected internal bundles; the generated ForecastBundle wrapper is next. No hidden fixture provider exists in this service. Pure window engine requires reviewed evidence and full rainfast continuity.

Milestone 3 DELIVERS the generated-contract facade in `backend/agrisense/science/facade.py`. Phase 3 can now import all four exports. All pure functions accept/return the generated 1.0 models. Snapshot facts are checked for mismatched identities/future events, recommendations replay deterministically, unavailable economics remains null.

Reference scalar record convention: `planning:<crop>`, `water:<crop>`, `product:<product_id>`, `economics:<crop>`, `scenario:<crop>:<sample_id>`. Every reviewed record requires `reviewed=true`, `evidence_id` present in the evidence catalog, and ISO `valid_from`/`valid_until`. Tests contain synthetic examples only. No approved production product/calendar records are shipped.

Phase 1: null fields are present explicitly in model JSON, not omitted. `status=insufficient_data` retains null readiness/timing/viability. Water daily replenishment values are alternatives, not volumes to sum across days; contract needs dated daily water records before UI can show them authoritatively.

Milestone 4 adds `science/data.py` and `science/validation.py`, offline `science/training/train_yield.py`, source registry, rules-only model card and repeatable CPU benchmark. Run training with `PYTHONPATH=backend`; require explicit --software-test for synthetic exports. No registry promotion or remote model write occurs. Operator explicitly forbids merging other branches in this session.

Milestone 5 removes inherited implicit live-to-demo fallback and false missing-weather defaults in CE Hub/Open-Meteo, disables dimensionally invalid drought advice and unsupported stress-to-money uplift, and prevents legacy window certification without required inputs. Platform should consume the generated facade, not the legacy resolver/scoring output. The legacy meteoblue shape still needs migration and is not used by the new facade.

Milestone 6: CE Hub daily forecast now feeds the facade's stress curve. Live `PYTHONPATH=backend .venv/bin/python science/evaluation/probe_science_live.py --env ../agrisense.env` passed; output contains only capability counts/status/warnings. Forecast bias module is shadow-only. Empirical training exports now require `label_available_at`; late-confirmed outcomes are excluded from earlier splits.

Milestone 7 resolves Phase 3’s reference-loader blocker: import `agrisense.science.references.reference_bundle` and call with no arguments. Returns fresh `ReferenceBundle(version="rules-only-unreviewed-v1")` with five crop identities and empty products/evidence/parameters. Catalog membership is not scientific approval. The gateway can now return honest insufficient_data after this code is integrated by the owners.

Snapshot timing: capture farm facts at snapshot.as_of, then fetch weather normally. The facade preserves the snapshot and evaluates at max(snapshot.as_of, forecast.retrieved_at); generated_at follows that time. Historical validation separately enforces archived issue/observation cutoffs. Live probe now exercises this ordering successfully. No platform code, generated schemas or other branches modified.
