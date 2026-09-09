# Rules-only scientific model card

Version: `advisory_v1.0.0`. State: **implemented, awaiting empirical and agronomist validation**.

Purpose: reproducible stress diagnostics, hard-constrained window screening, explicit water scenarios, crop feasibility and whole-season economic arithmetic. India biological scope: rice, wheat and cotton; maize/soybean reference reproduction and regional planning only when complete local evidence is supplied.

No trained or field-calibrated production model is shipped. Readiness is not a success probability. Scenario quantiles are not calibrated prediction intervals. Biological incremental value is unavailable without crop/product/stage response evidence. Source drought and nutrient indices are never fertilizer prescriptions.

Daily water uses the standard-demand FAO balance; unknown initial storage stays unknown. Flooded rice is demand-only pending ponded-water management inputs. Daily replenishment alternatives must not be summed as a weekly irrigation schedule. The v1 API needs dated richer water outputs.

Weather: CE Hub metadata and batched hourly query tested live. Unknown sum-interval/issue semantics remain explicit; no certified application block can use unconfirmed intervals. Open-Meteo normalization is fixture tested and uses its documented preceding-hour values; free endpoint requires explicit permitted-use configuration. Station and meteoblue query entitlements remain external prerequisites. No NASA history is presented as future weather.

Offline learning job: `science/training/train_yield.py`. Baseline residual correction and optional XGBoost fit only training rows; splits separate farmers/fields and move forward in time. Calibration and held-out test remain separate. Future features and synthetic-to-empirical contamination are rejected. Small synthetic command smoke tests validate software only. No universal sample size or accuracy guarantee is claimed.

Promotion requires empirical outcomes, preregistered comparison/coverage criteria, no hard safety violations, subgroup review and an authorized reviewer tied to an immutable evaluation. The validation utility does not modify a live model or registry. Rollback means selecting the prior approved immutable version through the platform-owned registry.
