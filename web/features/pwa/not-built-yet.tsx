"use client";

import { AppShell } from "@/components/app-shell";
import { Callout, Card } from "@/components/ui";
import Link from "next/link";

/**
 * Honest placeholder for a navigation destination that is routed but not built.
 *
 * The bottom and side navigation are part of the shell, so their four
 * destinations must resolve to something. A 404 would read as a broken app, and
 * a screen of invented figures is explicitly disallowed. This says what the
 * screen will do, which requirement owns it, and what it is waiting on.
 */
export function NotBuiltYet({
  title,
  requirement,
  summary,
  dependsOn,
}: {
  title: string;
  requirement: string;
  summary: string;
  dependsOn?: string[];
}) {
  return (
    <AppShell title={title}>
      <div className="mx-auto max-w-[46rem] space-y-4">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate">{requirement}</p>
          <h2 className="mt-1 text-h2 font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-slate">{summary}</p>
        </Card>

        <Callout tone="info" title="Not built yet">
          <p>
            This screen is routed so the navigation is not broken, but it is not implemented. No
            placeholder figures are shown, because a number here would be indistinguishable from a
            real one.
          </p>
          {dependsOn && dependsOn.length > 0 ? (
            <>
              <p className="mt-2 font-semibold text-ink">Waiting on</p>
              <ul className="mt-1 space-y-1">
                {dependsOn.map((item) => (
                  <li key={item} className="font-mono text-xs">
                    {item}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Callout>

        <Link href="/" className="inline-block text-sm font-semibold text-forest underline">
          Back to home
        </Link>
      </div>
    </AppShell>
  );
}
