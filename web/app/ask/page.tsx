"use client";

import { NotBuiltYet } from "@/features/pwa/not-built-yet";

export default function AskPage() {
  return (
    <NotBuiltYet
      title="Ask"
      requirement="P1-08 · assistant with authorized context"
      summary="Ask about your own field in your own language, by text or voice. Answers cite the records they came from, and any change to your data is shown as a proposal you confirm — never applied silently."
      dependsOn={[
        "POST /api/v1/conversations",
        "POST /api/v1/conversations/{id}/messages",
        "Gemini configuration (absent from the supplied environment)",
      ]}
    />
  );
}
