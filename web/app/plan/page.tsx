"use client";

import { NotBuiltYet } from "@/features/pwa/not-built-yet";

export default function PlanPage() {
  return (
    <NotBuiltYet
      title="Plan"
      requirement="P1-03 · crop selection and comparison"
      summary="Choose a crop for a field, or compare up to five eligible candidates on sowing window, water need, compatibility and estimated return — under one shared area, budget and date assumption."
      dependsOn={["POST /api/v1/planning/compare", "GET /api/v1/catalog/crops"]}
    />
  );
}
