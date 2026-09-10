"use client";

/**
 * The end-of-season screen: close it, then see how the advice did.
 *
 * One screen rather than two, because they are one decision in the farmer's
 * head — "I'm done, how did it go" — and because the review has nothing to show
 * until the closure exists.
 */
import { AppShell } from "@/components/app-shell";
import { Button, Callout, Card, ErrorState, Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { useCrops } from "@/features/crops/use-crop-name";
import type { SeasonEvaluation } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/query";
import { seasons as seasonsApi } from "@/lib/api/routes";
import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CloseSeasonForm } from "./close-season-form";
import { PredictionReview } from "./prediction-review";

export function CloseSeasonScreen({ seasonId }: { seasonId: string }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { nameFor } = useCrops();

  const seasonQuery = useApiQuery(
    [uid, "season", seasonId],
    (signal) => seasonsApi.get(seasonId, { signal }),
    { enabled: Boolean(uid) },
  );

  // Fetched regardless of status: a season closed on another device should show
  // its review here rather than offering to close it again.
  const summaryQuery = useApiQuery(
    [uid, "season", seasonId, "summary"],
    (signal) => seasonsApi.summary(seasonId, { signal }),
    { enabled: Boolean(uid) },
  );

  // Held locally so the review appears immediately after closing, without
  // waiting for a refetch to prove what the request already returned.
  const [justClosed, setJustClosed] = useState<SeasonEvaluation | null>(null);
  const [editing, setEditing] = useState(false);

  const season = seasonQuery.data ?? null;
  const evaluation = justClosed ?? summaryQuery.data ?? null;
  const closed = season?.status === "closed" || evaluation?.closure != null;
  const cropName = season ? nameFor(season.crop_id) : "this";

  return (
    <AppShell title={closed ? "How the season went" : "End the season"}>
      <div className="space-y-4">
        {seasonQuery.isLoading ? (
          <Skeleton className="h-56 w-full rounded-card" />
        ) : seasonQuery.error ? (
          <ErrorState title="Could not load this season" message={seasonQuery.error.message} />
        ) : !season ? null : closed && evaluation ? (
          <>
            {justClosed ? (
              <Callout tone="success" title={`The ${cropName} season is closed`}>
                Your figures are recorded. Below is how AgriSense&rsquo;s advice compared with
                what actually happened.
              </Callout>
            ) : null}
            <PredictionReview evaluation={evaluation} cropName={cropName} />
            <Card className="p-4">
              <p className="text-sm font-semibold text-ink">What next?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/plan-crop"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-control bg-forest px-3 text-sm font-semibold text-white"
                >
                  Plan the next crop
                </Link>
                <Link
                  href={`/journal?season=${encodeURIComponent(seasonId)}`}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-mist px-3 text-sm font-semibold text-ink"
                >
                  <NotebookPen aria-hidden className="size-4 text-forest" />
                  Look back at the journal
                </Link>
              </div>
            </Card>
          </>
        ) : closed ? (
          // Status says closed but no closure record came back. Saying so beats
          // offering a close form that will be refused with a version conflict.
          <Callout tone="caution" title="This season is already closed">
            Its closing figures could not be loaded just now, so there is nothing to compare.
            Try again in a moment.
          </Callout>
        ) : editing ? (
          <CloseSeasonForm
            season={season}
            cropName={cropName}
            onClosed={(result) => {
              setJustClosed(result);
              setEditing(false);
              void seasonQuery.refetch();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Card className="p-5">
            <h2 className="text-h3 font-semibold">Has the {cropName} season finished?</h2>
            <p className="mt-1.5 text-sm text-slate">
              Once you have harvested, record what you actually got and what it sold for.
              AgriSense then shows you how its own advice compared with what happened, which is
              how you judge whether to trust it next season.
            </p>
            <p className="mt-2 text-sm text-slate">
              Closing stops advice for this season. Nothing is deleted.
            </p>
            <Button size="lg" className="mt-4" onClick={() => setEditing(true)}>
              Record the harvest
            </Button>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
