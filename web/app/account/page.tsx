"use client";

import { Skeleton } from "@/components/ui";
import { AccountScreen } from "@/features/account/account-screen";
import { useAuth } from "@/features/auth/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AccountPage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status === "signed-out" || status === "initialising") {
    return (
      <main id="main" className="w-full space-y-4 px-4 py-6" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </main>
    );
  }
  return <AccountScreen />;
}
