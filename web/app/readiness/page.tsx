"use client";

import { Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { ReadinessScreen } from "@/features/readiness/readiness-screen";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function Inner() {
  const params = useSearchParams();
  const seasonId = params.get("season");
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
    if (status === "signed-in" && !seasonId) router.replace("/");
  }, [status, seasonId, router]);

  if (status !== "signed-in" || !seasonId) return <Loading />;
  return <ReadinessScreen seasonId={seasonId} />;
}

function Loading() {
  return (
    <main id="main" className="w-full space-y-4 px-4 py-6" aria-busy="true">
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-56 w-full rounded-card" />
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}
