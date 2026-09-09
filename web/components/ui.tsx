"use client";

import { cn, stressToken } from "@/lib/utils";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

/* ---------------------------------------------------------------- Button */

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control font-semibold",
        "transition-[background-color,border-color,color,transform] duration-[120ms] ease-out",
        "disabled:cursor-not-allowed disabled:opacity-55 active:not-disabled:translate-y-px",
        size === "lg" ? "min-h-[52px] px-6 text-body" : "min-h-[44px] px-4 text-sm",
        variant === "primary" &&
          "bg-forest text-white hover:bg-[color-mix(in_srgb,var(--forest)_88%,black)]",
        variant === "secondary" &&
          "border border-mist bg-card text-ink hover:bg-[color-mix(in_srgb,var(--mist)_45%,var(--card))]",
        variant === "ghost" &&
          "text-forest hover:bg-[color-mix(in_srgb,var(--sprout)_10%,transparent)]",
        variant === "danger" && "bg-clay text-white",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag className={cn("rounded-card border border-mist bg-card", className)}>
      {children}
    </Tag>
  );
}

/* ----------------------------------------------------------- Build Sprint */

/**
 * A control that does not work yet. It is visibly disabled and says why, because
 * a button that silently does nothing is worse than no button.
 */
export function BuildSprint({
  label,
  note,
  className,
}: {
  label: string;
  note: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-control border border-dashed border-mist bg-[color-mix(in_srgb,var(--mist)_28%,var(--card))] p-3",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Lock aria-hidden className="size-4 shrink-0 text-slate" />
        <span className="text-sm font-semibold text-slate">{label}</span>
        <span className="ml-auto rounded-full bg-[color-mix(in_srgb,var(--navy)_12%,transparent)] px-2 py-0.5 text-xs font-semibold text-navy">
          Build Sprint
        </span>
      </div>
      <p className="mt-1.5 text-xs text-slate">{note}</p>
    </div>
  );
}

/* --------------------------------------------------------------- Feedback */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <Card className="p-6 text-center">
      <AlertTriangle aria-hidden className="mx-auto size-7 text-amber" />
      <h2 className="mt-3 text-h3 font-semibold">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-[52ch] text-sm text-slate">{message}</p>
      {onRetry ? (
        <Button className="mt-4" onClick={onRetry}>
          <RefreshCw aria-hidden className="size-4" />
          {retryLabel}
        </Button>
      ) : null}
    </Card>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-mist px-6 py-10 text-center">
      <h3 className="text-h3 font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-[48ch] text-sm text-slate">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------- Stress chip */

export function StressChip({
  value,
  label,
  notApplicableLabel = "Not applicable",
}: {
  value: number | null;
  label?: string;
  notApplicableLabel?: string;
}) {
  const applicable = value !== null && value !== undefined;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: stressToken(value) }}
      />
      <span className="tabular font-semibold">
        {applicable ? value.toFixed(1) : notApplicableLabel}
      </span>
      {label ? <span className="text-slate">{label}</span> : null}
    </span>
  );
}
