/**
 * Grouping for the seven-day plan.
 *
 * Pure functions, no React, so the date arithmetic can be reasoned about on its
 * own. Everything goes through `istDateKey` from lib/format rather than local
 * `Date` methods: the UTC-to-IST boundary is 18:30Z, and constructing a day
 * from the browser's own timezone would put a task on the wrong morning for any
 * device not set to IST — which is the whole point of the product.
 */
import { istDateKey } from "@/lib/format";
import type { Task } from "@/lib/api/contract";

/** Tasks a farmer can still act on. `expired` and `cancelled` are history. */
export const ACTIONABLE_STATUSES: ReadonlySet<Task["status"]> = new Set<Task["status"]>([
  "pending",
  "snoozed",
]);

export type TaskGroup = {
  /** `YYYY-MM-DD` in IST, or `"overdue"` / `"later"`. */
  key: string;
  kind: "overdue" | "day" | "later";
  /** Representative instant for the group, for date formatting. Null for buckets. */
  at: string | null;
  tasks: Task[];
};

/**
 * Priority order for sorting within a day.
 *
 * `critical` first: if a farmer only reads the top of the list, it should be the
 * thing that matters most.
 */
const PRIORITY_RANK: Record<Task["priority"], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function comparePriority(a: Task, b: Task): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  // Then by when the window opens, so the day reads chronologically.
  return a.due.start_at.localeCompare(b.due.start_at);
}

/** A task is overdue when its window has closed and it is still actionable. */
export function isOverdue(task: Task, now: Date): boolean {
  if (!ACTIONABLE_STATUSES.has(task.status)) return false;
  const end = Date.parse(task.due.end_at);
  if (Number.isNaN(end)) return false;
  return end < now.getTime();
}

/**
 * Builds the day buckets.
 *
 * Returns overdue first (the spec asks for it separately), then one group per
 * IST calendar day for `days` days starting today — including days with no
 * tasks, so the plan reads as a calendar rather than a list that silently skips
 * quiet days. Anything beyond the horizon is collected into `later` so nothing
 * is dropped without being counted.
 */
export function groupTasks(tasks: readonly Task[], now: Date = new Date(), days = 7): TaskGroup[] {
  const actionable = tasks.filter((t) => ACTIONABLE_STATUSES.has(t.status));

  const overdue: Task[] = [];
  const byDay = new Map<string, Task[]>();
  const later: Task[] = [];

  const todayKey = istDateKey(now.toISOString());
  const horizon = new Set<string>();
  const horizonOrder: Array<{ key: string; at: string }> = [];

  if (todayKey) {
    for (let i = 0; i < days; i += 1) {
      // Step in whole UTC days from today's IST midnight. Adding 24h to an
      // instant is safe here because IST has no daylight-saving transitions.
      const at = new Date(`${todayKey}T00:00:00Z`);
      at.setUTCDate(at.getUTCDate() + i);
      const iso = at.toISOString();
      const key = iso.slice(0, 10);
      horizon.add(key);
      horizonOrder.push({ key, at: iso });
    }
  }

  for (const task of actionable) {
    if (isOverdue(task, now)) {
      overdue.push(task);
      continue;
    }
    const key = istDateKey(task.due.start_at);
    if (key && horizon.has(key)) {
      const bucket = byDay.get(key);
      if (bucket) bucket.push(task);
      else byDay.set(key, [task]);
    } else {
      later.push(task);
    }
  }

  const groups: TaskGroup[] = [];

  if (overdue.length > 0) {
    groups.push({
      key: "overdue",
      kind: "overdue",
      at: null,
      tasks: overdue.sort(comparePriority),
    });
  }

  for (const { key, at } of horizonOrder) {
    groups.push({
      key,
      kind: "day",
      at,
      tasks: (byDay.get(key) ?? []).sort(comparePriority),
    });
  }

  if (later.length > 0) {
    groups.push({ key: "later", kind: "later", at: null, tasks: later.sort(comparePriority) });
  }

  return groups;
}

/** Counts for the summary line. Nothing here invents a number. */
export function planCounts(tasks: readonly Task[], now: Date = new Date()) {
  const actionable = tasks.filter((t) => ACTIONABLE_STATUSES.has(t.status));
  return {
    actionable: actionable.length,
    overdue: actionable.filter((t) => isOverdue(t, now)).length,
    critical: actionable.filter((t) => t.priority === "critical").length,
  };
}

/**
 * Turns a reason code into a sentence.
 *
 * The contract gives a machine `code` plus a `facts` map. There is no
 * server-supplied prose, so unknown codes fall back to the code itself with its
 * facts listed rather than being hidden — a farmer seeing a raw code is far
 * better than a task with no stated reason, and it makes the missing mapping
 * visible instead of silently swallowed.
 */
const REASON_TEXT: Record<string, string> = {
  spray_window_open: "The spray window for this field is open.",
  spray_window_closing: "This spray window closes soon.",
  heat_stress_forecast: "Heat stress is forecast for this field.",
  irrigation_due: "Soil moisture is projected to fall below the target.",
  rain_expected: "Rain is forecast, which affects when to spray.",
};

export function reasonSentence(code: string): string | null {
  return REASON_TEXT[code] ?? null;
}

/** `facts` rendered as `label: value` pairs, skipping nulls. */
export function factPairs(
  facts: Record<string, string | number | boolean | null> | undefined,
): Array<[string, string]> {
  if (!facts) return [];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(facts)) {
    if (value === null) continue;
    out.push([key.replace(/_/g, " "), String(value)]);
  }
  return out;
}
