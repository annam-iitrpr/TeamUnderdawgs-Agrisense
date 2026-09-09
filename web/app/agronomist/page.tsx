"use client";

import { Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { AgronomistDashboard } from "@/features/agronomist/agronomist-dashboard";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Deliberately not linked from the farmer navigation.
 *
 * Authorisation is decided by the server on each request, so the route is safe
 * to exist — an unauthorised caller gets a clear "no access" state rather than
 * any data. It is simply not advertised to accounts that cannot use it.
 */
export default function AgronomistPage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status === "signed-out" || status === "initialising") {
    return (
      <main id="main" className="mx-auto w-full max-w-[70rem] space-y-4 px-4 py-6" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </main>
    );
  }

  return <AgronomistDashboard />;
}
