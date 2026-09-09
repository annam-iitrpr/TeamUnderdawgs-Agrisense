"use client";

/**
 * P1-11 — the agronomist dashboard.
 *
 * Access is decided by the server. The gate asks for the summary and treats a
 * 403 as the authoritative "not an agronomist"; there is no client-side role
 * state anywhere in this feature, because any such state would be both
 * unauthoritative and forgeable.
 *
 * The panels below render only once that request has actually succeeded, so a
 * farmer never sees a partially-populated agronomist view.
 */
import { AppShell } from "@/components/app-shell";
import { Callout } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { AccessGateNotice, useAgronomistAccess } from "./access-gate";
import { EvidencePanel, FieldsPanel, ModelsPanel, SummaryTiles } from "./panels";
import { StressMapPanel } from "./stress-map-panel";

export function AgronomistDashboard() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const access = useAgronomistAccess(uid);

  if (access.kind !== "authorised") {
    return (
      <AppShell title="Agronomist">
        <AccessGateNotice state={access} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Agronomist">
      <div className="space-y-6">
        <Callout tone="info" className="text-xs">
          These views aggregate the farmers assigned to you. Individual records remain each
          farmer&apos;s own; locations are shown coarsely in overviews.
        </Callout>

        <SummaryTiles summary={access.summary} dataMode={access.dataMode} />
        <StressMapPanel uid={uid} />
        <FieldsPanel uid={uid} />
        <ModelsPanel uid={uid} />
        <EvidencePanel uid={uid} />
      </div>
    </AppShell>
  );
}
