"use client";

import { NotBuiltYet } from "@/features/pwa/not-built-yet";

export default function JournalPage() {
  return (
    <NotBuiltYet
      title="Journal"
      requirement="P1-07 · season journal and action capture"
      summary="A timeline of what actually happened on the field — watering, fertiliser, biological and pesticide sprays, weeding, observations and harvest — with photos and voice notes reviewed and confirmed before anything is saved as fact."
      dependsOn={[
        "GET /api/v1/seasons/{id}/journal",
        "POST /api/v1/seasons/{id}/journal",
        "POST /api/v1/media/uploads",
      ]}
    />
  );
}
