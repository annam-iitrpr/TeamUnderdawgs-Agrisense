"use client";

/**
 * Notification history.
 *
 * The distinction this screen exists to protect: a notification has `read_at`
 * and `acknowledged_at`, and NEITHER is evidence that farm work happened. Only
 * completing the linked task records that, and completing a task writes a
 * journal entry describing what was actually done.
 *
 * So the controls here are deliberately about the message — "Mark as read",
 * "Got it" — and any notification carrying a `task_id` shows a separate, clearly
 * labelled route to the task, with the difference stated in words rather than
 * left for the farmer to infer.
 */
import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import { Button, Callout, Card, ErrorState, Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError } from "@/lib/api/envelope";
import { useApiQuery } from "@/lib/api/query";
import { notifications as notificationsApi } from "@/lib/api/routes";
import type { Notification } from "@/lib/api/contract";
import { formatDateShort, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BellRing, Check, CheckCheck, ListChecks, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/** Delivery state matters: a "failed" alert may never have reached the farmer. */
const DELIVERY_META: Record<
  Notification["delivery_state"],
  { label: string; tone: "ok" | "warn" | "muted" }
> = {
  delivered: { label: "Delivered", tone: "ok" },
  sent: { label: "Sent", tone: "ok" },
  pending: { label: "Not sent yet", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
  failed: { label: "Could not be delivered", tone: "warn" },
};

export function NotificationsScreen() {
  const { t } = useLanguage();
  const { status, user } = useAuth();
  const uid = user?.uid ?? null;

  const query = useApiQuery(
    [uid, "notifications"],
    (signal) => notificationsApi.list({ signal, limit: 100 }),
    { enabled: Boolean(uid) },
  );

  const items = query.data?.items ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <AppShell title="Notifications">
      <div className="space-y-4">
        {status === "initialising" || query.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-card" />
            <Skeleton className="h-24 w-full rounded-card" />
          </div>
        ) : query.error ? (
          <ErrorState
            title={
              query.error.isDependencyUnavailable
                ? "Notifications are unavailable right now"
                : t("errorTitle")
            }
            message={query.error.message}
            retryLabel={t("retry")}
            onRetry={query.error.retryable ? query.refetch : undefined}
          />
        ) : items.length === 0 ? (
          <Card className="p-5 text-center">
            <BellRing aria-hidden className="mx-auto size-7 text-forest" />
            <h2 className="mt-3 text-h3 font-semibold">No alerts yet</h2>
            <p className="mx-auto mt-1.5 max-w-[46ch] text-sm text-slate">
              AgriSense will message you when a spray window opens, when conditions change enough
              to matter, or when watering is due. Nothing has needed your attention so far.
            </p>
          </Card>
        ) : (
          <>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm">
                <span className="font-semibold text-ink">{items.length}</span>{" "}
                {items.length === 1 ? "alert" : "alerts"}
                {unread > 0 ? (
                  <span className="ml-2 font-semibold text-navy">{unread} unread</span>
                ) : null}
              </p>
            </Card>

            <Callout tone="info" className="text-xs">
              Reading or acknowledging an alert records only that you saw it. It does not record
              that the work was done — for that, mark the task done in your plan, which asks what
              you actually did.
            </Callout>

            <ul className="space-y-3">
              {items.map((notification) => (
                <li key={notification.id}>
                  <NotificationRow notification={notification} onChanged={query.refetch} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}

function NotificationRow({
  notification,
  onChanged,
}: {
  notification: Notification;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const delivery = DELIVERY_META[notification.delivery_state];
  const isRead = Boolean(notification.read_at);
  const isAcked = Boolean(notification.acknowledged_at);

  async function patch(body: { read?: boolean; acknowledged?: boolean }) {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await notificationsApi.patch(notification.id, {
        expected_version: notification.version,
        ...body,
      });
      onChanged();
    } catch (cause) {
      if (cause instanceof ApiError && cause.isVersionConflict) setConflict(true);
      else if (cause instanceof ApiError) setError(cause.message);
      else setError("Could not update this alert.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cn("p-4", !isRead && "border-navy/30")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-h3 font-semibold text-ink">{notification.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate">
            <span>
              {formatDateShort(notification.created_at)} · {formatTime(notification.created_at)}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 font-semibold",
                delivery.tone === "warn"
                  ? "text-clay"
                  : delivery.tone === "ok"
                    ? "text-forest"
                    : "text-slate",
              )}
            >
              {delivery.tone === "warn" ? (
                <TriangleAlert aria-hidden className="size-3.5" />
              ) : null}
              {delivery.label}
            </span>
            {isRead ? (
              <span className="inline-flex items-center gap-1">
                <Check aria-hidden className="size-3.5" />
                Read
              </span>
            ) : (
              <span className="font-semibold text-navy">Unread</span>
            )}
            {isAcked ? (
              <span className="inline-flex items-center gap-1">
                <CheckCheck aria-hidden className="size-3.5" />
                Acknowledged
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <p className="mt-2 text-sm text-ink">{notification.body}</p>

      {/*
        A notification that points at a task gets a visually separate route to
        it. This is the only control on this screen that leads to recording
        actual work, and the copy says so — the spec is explicit that
        acknowledging an alert must not be mistaken for doing the job.
      */}
      {notification.task_id ? (
        <div className="mt-3 rounded-control border border-mist bg-[color-mix(in_srgb,var(--sprout)_8%,var(--card))] p-3">
          <p className="text-sm font-semibold text-ink">This alert asks you to do something</p>
          <p className="mt-0.5 text-xs text-slate">
            Marking this alert read is not the same as doing it. Open your plan to record what you
            actually did.
          </p>
          <Link href="/plan" className="mt-2 inline-block">
            <Button variant="secondary">
              <ListChecks aria-hidden className="size-4" />
              Open my plan
            </Button>
          </Link>
        </div>
      ) : null}

      {conflict ? (
        <Callout tone="caution" className="mt-3 text-sm" title="This alert changed">
          <p>It was updated elsewhere. Refresh to see the current version.</p>
          <Button variant="secondary" className="mt-2" onClick={onChanged}>
            Refresh
          </Button>
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="blocked" className="mt-3 text-sm">
          {error}
        </Callout>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {!isRead ? (
          <Button variant="secondary" busy={busy} onClick={() => void patch({ read: true })}>
            <Check aria-hidden className="size-4" />
            Mark as read
          </Button>
        ) : null}
        {!isAcked ? (
          <Button
            variant="secondary"
            busy={busy}
            onClick={() => void patch({ read: true, acknowledged: true })}
          >
            <CheckCheck aria-hidden className="size-4" />
            Got it
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
