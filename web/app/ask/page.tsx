"use client";

import { Skeleton } from "@/components/ui";
import { AskScreen } from "@/features/ask/ask-screen";
import { useAuth } from "@/features/auth/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AskPage() {
  const { status } = useAuth();
  const router = useRouter();

  // The assistant answers from the farmer's own records, so it needs a session.
  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status === "signed-out" || status === "initialising") {
    return (
      <main id="main" className="mx-auto w-full max-w-[48rem] space-y-4 px-4 py-6" aria-busy="true">
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </main>
    );
  }

  return <AskScreen />;
}
