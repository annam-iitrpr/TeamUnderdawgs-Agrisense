"use client";

/**
 * Authorisation gate for the agronomist views.
 *
 * The contract's `Farmer` record carries no role or membership field — id,
 * tenant, display name, language, timezone, consents, linked channels and
 * version, and nothing else. So the client genuinely cannot know in advance
 * whether the caller is an agronomist, and this screen must not guess.
 *
 * It therefore gates on the server's own answer: it asks for the summary, and a
 * `403` is treated as the authoritative "not an agronomist". That is the right
 * way round anyway. Role is derived from verified identity and database
 * membership on the server, and any client-side role state would be both
 * unauthoritative and trivially forgeable — the spec explicitly forbids a fake
 * role switch that grants access.
 *
 * Four outcomes are kept distinct, because they call for different words and
 * different actions:
 *   403  you do not have access — final, no retry offered
 *   503  the service is down — not about you, retry is reasonable
 *   401  your session lapsed — sign in again
 *   200  authorised
 */
import { Button, Callout, Card, Skeleton } from "@/components/ui";
import { ApiError } from "@/lib/api/envelope";
import { useApiQuery } from "@/lib/api/query";
import { agronomist } from "@/lib/api/routes";
import { narrowSummary, type NarrowedSummary } from "./narrow";
import Link from "next/link";
import type { ReactNode } from "react";

export type GateState =
  | { kind: "loading" }
  | { kind: "authorised"; summary: NarrowedSummary | null; dataMode: string | null }
  | { kind: "forbidden" }
  | { kind: "unauthenticated" }
  | { kind: "unavailable"; message: string; retry: () => void }
  | { kind: "error"; message: string; retry: (() => void) | null };

export function useAgronomistAccess(uid: string | null): GateState {
  const query = useApiQuery(
    [uid, "agronomist", "summary"],
    (signal) => agronomist.summary({ signal }),
    { enabled: Boolean(uid) },
  );

  if (query.isLoading) return { kind: "loading" };

  const error = query.error;
  if (error instanceof ApiError) {
    if (error.code === "forbidden") return { kind: "forbidden" };
    if (error.code === "unauthenticated") return { kind: "unauthenticated" };
    if (error.isDependencyUnavailable) {
      return { kind: "unavailable", message: error.message, retry: query.refetch };
    }
    return {
      kind: "error",
      message: error.message,
      retry: error.retryable ? query.refetch : null,
    };
  }

  return {
    kind: "authorised",
    summary: narrowSummary(query.data),
    dataMode: query.meta?.data_mode ?? null,
  };
}

/** Renders the non-authorised states. Returns null once authorised so the
 *  caller can render the dashboard itself. */
export function AccessGateNotice({ state }: { state: GateState }): ReactNode {
  if (state.kind === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <Card className="mx-auto max-w-[40rem] p-6 text-center">
        <h2 className="text-h2 font-semibold">You do not have access to this</h2>
        <p className="mx-auto mt-2 max-w-[46ch] text-sm text-slate">
          These views are for Syngenta and FPO agronomists, who see the farmers assigned to them.
          Your account is not one of those, so there is nothing here for it to show.
        </p>
        <p className="mx-auto mt-2 max-w-[46ch] text-xs text-slate">
          Access is granted on the server against your account&apos;s membership. It cannot be
          switched on from this device, and this screen does not offer a way to try.
        </p>
        <Link href="/" className="mt-4 inline-block">
          <Button variant="secondary">Back to your fields</Button>
        </Link>
      </Card>
    );
  }

  if (state.kind === "unauthenticated") {
    return (
      <Card className="mx-auto max-w-[40rem] p-6 text-center">
        <h2 className="text-h2 font-semibold">Please sign in again</h2>
        <p className="mt-2 text-sm text-slate">Your session is no longer valid.</p>
        <Link href="/sign-in?reason=expired" className="mt-4 inline-block">
          <Button>Sign in</Button>
        </Link>
      </Card>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <Callout tone="caution" title="These views are unavailable right now" className="mx-auto max-w-[46rem]">
        <p>{state.message}</p>
        <p className="mt-2">
          This is a service AgriSense depends on, not a problem with your account. Nothing is
          being shown in its place.
        </p>
        <Button variant="secondary" className="mt-3" onClick={state.retry}>
          Try again
        </Button>
      </Callout>
    );
  }

  if (state.kind === "error") {
    return (
      <Callout tone="blocked" title="Something went wrong" className="mx-auto max-w-[46rem]">
        <p>{state.message}</p>
        {state.retry ? (
          <Button variant="secondary" className="mt-3" onClick={state.retry}>
            Try again
          </Button>
        ) : null}
      </Callout>
    );
  }

  return null;
}
