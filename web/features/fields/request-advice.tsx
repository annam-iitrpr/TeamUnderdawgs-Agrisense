"use client";

/**
 * Asking AgriSense to work out advice for a season.
 *
 * Nothing in the app used to trigger an evaluation, so every downstream figure
 * — readiness, water, money, the risk strip — stayed empty for a farmer who had
 * done everything right. The route existed and the client even had a method for
 * it, but that method sent an empty body and the contract requires
 * `expected_version`, so it answered 422 for every caller.
 *
 * Evaluation is asynchronous. The API answers either with a finished bundle or
 * with a queued job, and both are handled: a job is polled to completion rather
 * than leaving the farmer looking at a spinner that never resolves or, worse, a
 * screen that quietly claims there is no advice.
 */
import { Button, Callout } from "@/components/ui";
import { newIdempotencyKey } from "@/lib/api/client";
import type { Job } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/envelope";
import { jobs as jobsApi, seasons as seasonsApi } from "@/lib/api/routes";
import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Polling bounds. Evaluation fetches live weather, so it is seconds, not instant. */
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 90_000;

function isJob(value: unknown): value is Job {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "kind" in value &&
    typeof (value as Job).id === "string"
  );
}

export function RequestAdvice({
  seasonId,
  expectedVersion,
  expired,
  autoRefresh,
  onEvaluated,
}: {
  seasonId: string;
  expectedVersion: number;
  /** Advice exists but has aged out, which reads differently from having none. */
  expired?: boolean;
  /**
   * Re-evaluate without being asked, once, when advice has merely gone stale.
   *
   * A spray window is only valid for 45 minutes because it names particular
   * hours, so by the time a farmer opens the app it has almost always expired.
   * Making them press a button to recover from that puts the cost of an
   * implementation detail onto the person: they did nothing wrong and there is
   * nothing to decide. It runs only for staleness, never for a season with no
   * advice at all — that is a real choice, and asking first is right.
   */
  autoRefresh?: boolean;
  onEvaluated: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Polling must stop if the card unmounts, or a field switch leaves a timer
  // running against a season nobody is looking at.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  async function waitFor(jobId: string): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (live.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (!live.current) return;
      const { data } = await jobsApi.get(jobId);
      if (data.status === "succeeded") return;
      // `dead_letter` and `cancelled` are terminal too. Treating only "failed"
      // as terminal would poll a dead job until the timeout and then report it
      // as merely slow.
      if (
        data.status === "failed" ||
        data.status === "dead_letter" ||
        data.status === "cancelled"
      ) {
        throw new Error(
          data.error?.message
            ? `The evaluation could not be completed: ${data.error.message}`
            : "The evaluation could not be completed.",
        );
      }
    }
    // Not an error: the work is still queued and will land. Saying so beats
    // implying it failed, and beats spinning forever.
    throw new Error("still_running");
  }

  async function run() {
    setWorking(true);
    setError(null);
    setNote(null);
    try {
      const { data } = await seasonsApi.evaluate(
        seasonId,
        expectedVersion,
        newIdempotencyKey(),
      );
      if (isJob(data) && data.status !== "succeeded") {
        await waitFor(data.id);
      }
      if (live.current) onEvaluated();
    } catch (cause) {
      if (!live.current) return;
      if (cause instanceof Error && cause.message === "still_running") {
        setNote(
          "This is taking longer than usual. It is still running — check back in a minute.",
        );
      } else if (cause instanceof ApiError) {
        setError(
          cause.status === 409
            ? "This season changed while the request was in flight. Reload and try again."
            : cause.isDependencyUnavailable
              ? "AgriSense cannot work out advice right now because a service it depends on is unavailable."
              : cause.message,
        );
      } else {
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : "We cannot reach AgriSense right now.",
        );
      }
    } finally {
      if (live.current) setWorking(false);
    }
  }

  /**
   * Fires at most once per mount, guarded by a ref rather than by state.
   *
   * Without the guard a re-evaluation that itself returns stale advice — a
   * clock skew, or a season the engine keeps declining — would refresh in a
   * loop and hammer the API. One attempt, then the farmer decides.
   */
  const autoAttempted = useRef(false);
  useEffect(() => {
    if (!autoRefresh || !expired || autoAttempted.current) return;
    autoAttempted.current = true;
    void run();
    // `run` is stable enough for this: it closes over the season and version,
    // both of which change identity only when the card itself remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, expired]);

  return (
    <div className="mt-3">
      {autoRefresh && working ? (
        <p className="mb-2 text-xs text-slate" aria-live="polite">
          The last advice went out of date, so AgriSense is working it out again.
        </p>
      ) : null}
      <Button
        onClick={() => void run()}
        busy={working}
        busyLabel={expired ? "Refreshing" : "Working it out"}
        variant={expired ? "secondary" : "primary"}
      >
        {expired ? (
          <RefreshCw aria-hidden className="size-4" />
        ) : (
          <Sparkles aria-hidden className="size-4" />
        )}
        {expired ? "Refresh the advice" : "Work out my advice"}
      </Button>

      {working ? (
        <p className="mt-2 text-xs text-slate" aria-live="polite">
          Reading the weather for your field and working out the crop&rsquo;s stress. This takes
          a few seconds.
        </p>
      ) : null}

      {note ? (
        <Callout tone="info" className="mt-2 text-sm">
          {note}
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="blocked" className="mt-2 text-sm">
          {error}
        </Callout>
      ) : null}
    </div>
  );
}
