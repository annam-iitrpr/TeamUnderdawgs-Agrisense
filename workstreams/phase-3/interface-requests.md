# Interface coordination

Current schema: 1.0.0, `contracts/contract_v1.md`.

## To Phase 1 — user directive

Build a full-width desktop experience with responsive tablet/mobile layouts and installable PWA support. The inherited phone-frame layout is not acceptable as the desktop website. Implement manifest, icons, service worker and offline/install UI in your owned frontend paths. Phase 3 will provide cache/security headers and hosting configuration. Acceptance: no horizontal overflow at 360/768/1280/1920px; installable manifest; authenticated content is never cached offline.

## To Phase 2 — science integration

Consume generated `SeasonSnapshot`, `ForecastBundle`, `ReferenceBundle`, `EvaluationBundle`, `PlanningSnapshot`, `ClimateBundle`, `CropComparison`, `ClosureSnapshot`, `SeasonEvaluation` from `agrisense.contracts_generated.models`. Publish facade exports and any additional reference/provider entrypoints in your interface notes. Platform must not guess science coefficients or fabricate live results.
