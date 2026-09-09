"use client";

import { DataModeBadge } from "@/components/providers";
import { cn } from "@/lib/utils";
import { Sprout } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/backtest", label: "Backtest" },
  { href: "/algorithm-notes", label: "Algorithm notes" },
];

/**
 * The agronomist register. Cool navy structure, dense, multi column, data first.
 * Deliberately not the farmer layout stretched wide.
 */
export function DashboardShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-mist bg-navy text-white">
        <div className="mx-auto flex max-w-[86rem] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Sprout aria-hidden className="size-5" />
            <span className="text-h3 font-semibold tracking-tight">AgriSense</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">
              Agronomist
            </span>
          </Link>

          <nav className="flex items-center gap-1" aria-label="Dashboard sections">
            {NAV.map((n) => {
              const active =
                n.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-control px-3 py-1.5 text-sm font-semibold transition-colors duration-[120ms]",
                    active ? "bg-white/15 text-white" : "text-white/75 hover:text-white",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <Link href="/" className="text-sm font-semibold text-white/85 underline">
              Farmer view
            </Link>
            <DataModeBadge />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[86rem] px-5 py-6">
        <div className="mb-5">
          <h1 className="text-h1 font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate">{subtitle}</p> : null}
        </div>
        {children}
      </main>

      <footer className="mx-auto max-w-[86rem] border-t border-mist px-5 py-5 text-xs text-slate">
        <p>
          The agronomist dashboard is English only by design. Farmer facing screens
          are translated into Hindi and Marathi.
        </p>
        <p className="mt-1">
          <Link href="/algorithm-notes" className="font-semibold text-navy underline">
            Algorithm implementation notes
          </Link>
          {". Every constant traces to the Syngenta algorithm document."}
        </p>
      </footer>
    </div>
  );
}
