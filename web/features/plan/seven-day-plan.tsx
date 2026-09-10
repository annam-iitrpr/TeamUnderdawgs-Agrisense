"use client";

/**
 * P1-09 — the seven-day plan.
 *
 * Days are IST calendar days, and every empty day is still shown, so the plan
 * reads as a calendar rather than a list that silently skips quiet days. An
 * empty week is a legitimate answer and is presented as one, not as an error.
 */
import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import { Button, Callout, Card, DataModeBadge, ErrorState, Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { useApiQuery } from "@/lib/api/query";
import { tasks as tasksApi } from "@/lib/api/routes";
import type { Task } from "@/lib/api/contract";
import { formatDateWithWeekday, istDateKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACTIONABLE_STATUSES, groupTasks, planCounts } from "./task-grouping";
import { TaskCard, TaskHistory } from "./task-card";
import { RemindersPanel } from "./reminders-panel";
import { BellRing, CalendarCheck, CircleAlert } from "lucide-react";
import Link from "next/link";

export function SevenDayPlan() {
  const { t } = useLanguage();
  const { status, user } = useAuth();
  const uid = user?.uid ?? null;

  const query = useApiQuery(
    [uid, "tasks", "plan"],
    (signal) => tasksApi.list({ signal, limit: 100 }),
    { enabled: Boolean(uid) },
  );

  if (status === "initialising") {
    return (
      <AppShell title="Plan">
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Plan"
      headerActions={<DataModeBadge mode={query.meta?.data_mode} />}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {query.isLoading ? (
            <>
              <Skeleton className="h-20 w-full rounded-card" />
              <Skeleton className="h-40 w-full rounded-card" />
            </>
          ) : query.error ? (
            <ErrorState
              title={
                query.error.isDependencyUnavailable
                  ? "Your plan cannot be built right now"
                  : t("errorTitle")
              }
              message={query.error.message}
              retryLabel={t("retry")}
              onRetry={query.error.retryable ? query.refetch : undefined}
            />
          ) : (
            <PlanBody tasks={query.data?.items ?? []} onChanged={query.refetch} />
          )}
        </div>

        <div className="space-y-4">
          <RemindersPanel uid={uid} />
          <Card className="p-4">
            <h3 className="text-h3 font-semibold">Alerts</h3>
            <p className="mt-1.5 text-sm text-slate">
              Messages AgriSense has sent you, and whether you have read them.
            </p>
            <Link href="/notifications" className="mt-3 inline-block">
              <Button variant="secondary">
                <BellRing aria-hidden className="size-4" />
                Notifications
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function PlanBody({ tasks, onChanged }: { tasks: Task[]; onChanged: () => void }) {
  const now = new Date();
  const counts = planCounts(tasks, now);
  const groups = groupTasks(tasks, now, 7);
  const history = tasks.filter((task) => !ACTIONABLE_STATUSES.has(task.status));
  const todayKey = istDateKey(now.toISOString());

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="text-h3 font-semibold">Next seven days</h2>
        {counts.actionable === 0 ? (
          <p className="mt-1.5 text-sm text-slate">
            Nothing is scheduled for this week.
          </p>
        ) : (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate">
            <span className="font-semibold text-ink">
              {counts.actionable} {counts.actionable === 1 ? "task" : "tasks"}
            </span>
            {counts.overdue > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-clay">
                <CircleAlert aria-hidden className="size-3.5" />
                {counts.overdue} overdue
              </span>
            ) : null}
            {counts.critical > 0 ? (
              <span className="font-semibold text-clay">{counts.critical} critical</span>
            ) : null}
          </p>
        )}
      </Card>

      {/*
        An empty week is a real answer, not a failure. Tasks are created by the
        backend from a recommendation, and no recommendation exists yet while
        the science layer cannot evaluate — so this state is expected today and
        says why rather than looking broken.
      */}
      {counts.actionable === 0 ? (
        <Card className="p-5 text-center">
          <CalendarCheck aria-hidden className="mx-auto size-7 text-forest" />
          <h3 className="mt-3 text-h3 font-semibold">Nothing to do this week</h3>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-sm text-slate">
            AgriSense creates tasks from a field&apos;s spray recommendation. Once a field has a
            crop and a recommendation, watering and spray windows appear here with the reason
            behind each one.
          </p>
          <Link href="/" className="mt-4 inline-block">
            <Button variant="secondary">Go to my fields</Button>
          </Link>
        </Card>
      ) : (
        <ol className="space-y-4">
          {groups.map((group) => {
            if (group.kind === "day" && group.tasks.length === 0) {
              return (
                <li key={group.key}>
                  <div className="flex items-baseline gap-2 px-1">
                    <h3 className="text-sm font-semibold text-slate">
                      {group.at ? formatDateWithWeekday(group.at) : group.key}
                      {group.key === todayKey ? " · today" : ""}
                    </h3>
                    <span className="text-xs text-slate">nothing scheduled</span>
                  </div>
                </li>
              );
            }
            return (
              <li key={group.key} className="space-y-2">
                <h3
                  className={cn(
                    "px-1 text-sm font-semibold",
                    group.kind === "overdue" ? "text-clay" : "text-slate",
                  )}
                >
                  {group.kind === "overdue"
                    ? "Overdue"
                    : group.kind === "later"
                      ? "Later than seven days"
                      : `${group.at ? formatDateWithWeekday(group.at) : group.key}${
                          group.key === todayKey ? " · today" : ""
                        }`}
                </h3>
                <ul className="space-y-2">
                  {group.tasks.map((task) => (
                    <li key={task.id}>
                      <TaskCard
                        task={task}
                        overdue={group.kind === "overdue"}
                        onChanged={onChanged}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}

      <TaskHistory tasks={history} />

      <Callout tone="info" className="text-xs">
        Marking a task done records what you did. Reading an alert only marks the message as seen —
        the two are different, and neither is assumed from the other.
      </Callout>
    </div>
  );
}
