"use client";

import { Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function OnboardingPage() {
  const { status } = useAuth();
  const router = useRouter();

  // Onboarding writes a field against the signed-in farmer, so it is not
  // reachable without a session.
  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status !== "signed-in") {
    return (
      <main id="main" className="mx-auto w-full max-w-[34rem] space-y-4 px-4 py-6" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full rounded-card" />
        <Skeleton className="h-32 w-full rounded-card" />
      </main>
    );
  }

  return <OnboardingFlow />;
}
