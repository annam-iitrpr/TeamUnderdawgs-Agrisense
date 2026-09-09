"use client";

import { PhoneFrame } from "@/components/phone-frame";
import { useApp } from "@/components/providers";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError, type JournalResponse } from "@/lib/api";
import { cn, formatDay, formatHour } from "@/lib/utils";
import { CalendarCheck, CircleSlash, Eye, SprayCan } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type TimelineItem = {
  at: string;
  kind: "recommendation" | "spray" | "skipped" | "observation" | "note";
  title: string;
  body: string;
  photo?: string | null;
};

export default function HistoryPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { t, language } = useApp();

  const [data, setData] = useState<JournalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .journal(id)
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "We could not load the history."),
      );
  }, [id]);

  useEffect(load, [load]);

  if (error) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("seasonHistory")}>
        <div className="p-4">
          <ErrorState
            title={t("errorTitle")}
            message={error}
            retryLabel={t("retry")}
            onRetry={load}
          />
        </div>
      </PhoneFrame>
    );
  }

  if (!data) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("seasonHistory")}>
        <div className="space-y-3 p-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[5.5rem] w-full rounded-card" />
          ))}
        </div>
      </PhoneFrame>
    );
  }

  // Recommendations and journal entries interleaved, newest first. No scolding
  // tone anywhere: a skipped spray is recorded, not judged.
  const items: TimelineItem[] = [
    ...data.recommendations.map((r) => ({
      at: r.generated_at,
      kind: "recommendation" as const,
      title: r.window_start
        ? `Window suggested, ${formatHour(r.window_start)} to ${formatHour(r.window_end!)}`
        : "Advised to wait",
      body: r.reason_text,
    })),
    ...data.items.map((e) => ({
      at: e.logged_at,
      kind: (e.entry_type as TimelineItem["kind"]) ?? "note",
      title:
        e.entry_type === "spray"
          ? "Sprayed"
          : e.entry_type === "skipped"
            ? "Could not spray"
            : "Noted",
      body: e.text,
      photo: e.photo_path,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (items.length === 0) {
    return (
      <PhoneFrame backHref={`/field/${id}`} title={t("seasonHistory")}>
        <div className="p-4">
          <EmptyState
            title={t("historyEmpty")}
            message={t("journalEmpty")}
            action={
              <Link
                href={`/field/${id}/journal`}
                className="inline-flex min-h-[44px] items-center rounded-control bg-forest px-4 text-sm font-semibold text-white"
              >
                {t("journalTitle")}
              </Link>
            }
          />
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame backHref={`/field/${id}`} title={t("seasonHistory")}>
      <ol className="animate-rise space-y-0 p-4">
        {items.map((item, i) => (
          <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Continuous rail, stopped short on the final item. */}
            {i < items.length - 1 ? (
              <span
                aria-hidden
                className="absolute left-[15px] top-8 h-full w-px bg-mist"
              />
            ) : null}

            <span
              aria-hidden
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border",
                item.kind === "spray" &&
                  "border-sprout bg-[color-mix(in_srgb,var(--sprout)_14%,var(--card))] text-forest",
                item.kind === "skipped" &&
                  "border-mist bg-card text-slate",
                item.kind === "recommendation" &&
                  "border-navy bg-[color-mix(in_srgb,var(--navy)_10%,var(--card))] text-navy",
                (item.kind === "observation" || item.kind === "note") &&
                  "border-mist bg-card text-slate",
              )}
            >
              {item.kind === "spray" ? (
                <SprayCan className="size-4" />
              ) : item.kind === "skipped" ? (
                <CircleSlash className="size-4" />
              ) : item.kind === "recommendation" ? (
                <CalendarCheck className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </span>

            <Card className="flex-1 p-3">
              <p className="text-xs text-slate">{formatDay(item.at, language)}</p>
              <p className="mt-0.5 font-semibold">{item.title}</p>
              {item.body ? (
                <p className="mt-1 text-sm text-slate">{item.body}</p>
              ) : null}
              {item.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.photo}
                  alt="Photo attached to this journal entry"
                  className="mt-2 h-32 w-full rounded-control border border-mist object-cover"
                />
              ) : null}
            </Card>
          </li>
        ))}
      </ol>
    </PhoneFrame>
  );
}
