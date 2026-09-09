"use client";

import { Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { NotificationsScreen } from "@/features/plan/notifications-list";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function NotificationsPage() {
  const { status } = useAuth();
  const router = useRouter();

  // Alerts are addressed to one farmer, so this is not reachable unsigned.
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

  return <NotificationsScreen />;
}
