"use client";

import { Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { SevenDayPlan } from "@/features/plan/seven-day-plan";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The seven-day plan (P1-09).
 *
 * This route previously held a placeholder for P1-03 crop comparison, which is
 * blocked on the crop catalogue. The plan is the more useful occupant of the
 * "Plan" tab in the meantime, and comparison will need its own route anyway
 * since it is entered from a field rather than from navigation.
 */
export default function PlanPage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status === "signed-out") {
    return (
      <main id="main" className="mx-auto w-full max-w-[52rem] space-y-4 px-4 py-6" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-card" />
        <Skeleton className="h-32 w-full rounded-card" />
      </main>
    );
  }

  return <SevenDayPlan />;
}
