"use client";

import { Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { CropPlanner } from "@/features/planning/crop-planner";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function Planner() {
  const params = useSearchParams();
  const fieldId = params.get("field");
  const cropId = params.get("crop") ?? undefined;
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
    if (status === "signed-in" && !fieldId) router.replace("/");
  }, [status, fieldId, router]);

  if (status !== "signed-in" || !fieldId) return <Loading />;
  return <CropPlanner fieldId={fieldId} initialCropId={cropId} />;
}

function Loading() {
  return (
    <main id="main" className="w-full space-y-4 px-4 py-6" aria-busy="true">
      <Skeleton className="h-16 w-full rounded-card" />
      <Skeleton className="h-56 w-full rounded-card" />
    </main>
  );
}

export default function PlanCropPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Planner />
    </Suspense>
  );
}
