"use client";

import { Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { JournalScreen } from "@/features/journal/journal-screen";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function JournalPage() {
  const { status } = useAuth();
  const router = useRouter();

  // The journal is a farmer's own record, so it is not reachable unsigned.
  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status === "signed-out" || status === "initialising") {
    return (
      <main id="main" className="mx-auto w-full max-w-[52rem] space-y-4 px-4 py-6" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-card" />
        <Skeleton className="h-32 w-full rounded-card" />
      </main>
    );
  }

  return <JournalScreen />;
}
