"use client";

import { cn, stressToken } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────────────── Button */

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  busy?: boolean;
  busyLabel?: string;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Touch targets are 44px minimum, 52px at size "lg", per the spec's
 * 44–48px floor. A busy button stays disabled and announces its state, so a
 * double tap cannot fire a second mutation.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  busy = false,
  busyLabel,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control font-semibold",
        "transition-[background-color,border-color,color,transform] duration-[120ms] ease-out",
        "disabled:cursor-not-allowed disabled:opacity-55",
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
      {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

/* ───────────────────────────────────────────────────────────────────── Card */

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
    <Tag className={cn("rounded-card border border-mist bg-card", className)}>{children}</Tag>
  );
}

/* ──────────────────────────────────────────────────────────────── TextField */

type TextFieldProps = {
  label: string;
  /** Rendered next to the input and referenced by aria-describedby. */
  hint?: string;
  /** Field-level message. Moves focus here on submit failure. */
  error?: string;
  className?: string;
  /** React 19 accepts ref as a plain prop; forms use it to move focus to the
   *  first invalid input. */
  ref?: React.Ref<HTMLInputElement>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "className">;

/**
 * A labelled input. The label is always a real <label> bound by id — never a
 * placeholder standing in for one, which disappears the moment a farmer starts
 * typing and leaves the field unidentified to a screen reader.
 */
export function TextField({ label, hint, error, className, id, ref, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hint && hintId, error && errorId) || undefined}
        className={cn(
          "block min-h-[48px] w-full rounded-control border bg-card px-3 text-body text-ink",
          "placeholder:text-slate/70",
          error ? "border-clay" : "border-mist",
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-slate">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-clay">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── PasswordField */

type PasswordFieldProps = Omit<TextFieldProps, "type"> & {
  showLabel: string;
  hideLabel: string;
};

/** Password input with a show/hide toggle that is a real button, so it is
 *  reachable by keyboard and announces its state. */
export function PasswordField({
  showLabel,
  hideLabel,
  label,
  hint,
  error,
  className,
  id,
  ref,
  ...props
}: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const [visible, setVisible] = useState(false);

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {/* The toggle sits in its own flex column rather than absolutely over the
          input. Reserving fixed padding instead would overlap typed text in
          languages where the label is longer than English — the Telugu
          "పాస్‌వర్డ్ చూపించు" is roughly a third wider than "Show password". */}
      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-control border bg-card",
          "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-forest",
          error ? "border-clay" : "border-mist",
        )}
      >
        <input
          ref={ref}
          id={inputId}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(hint && hintId, error && errorId) || undefined}
          className="min-h-[48px] w-full min-w-0 flex-1 bg-transparent px-3 text-body text-ink outline-none"
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="shrink-0 border-l border-mist px-3 text-xs font-semibold text-forest"
        >
          {visible ? hideLabel : showLabel}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-slate">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-clay">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── Build Sprint */

/**
 * A control that does not work yet. Visibly disabled and says why, because a
 * button that silently does nothing is worse than no button.
 *
 * Retained from the contract_v1 bootstrap: the existing journal screen imports
 * it. Removed once that screen is rewritten under P1-07.
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

/* ─────────────────────────────────────────────────────────── Stress chip */

/** A 0-to-9 stress value with its severity word, so colour is never the only
 *  carrier. `null` reads as "Not applicable", not as "no risk". */
export function StressChip({
  value,
  label,
  notApplicableLabel = "Not applicable",
}: {
  value: number | null;
  label?: string;
  notApplicableLabel?: string;
}) {
  const applicable = value !== null && value !== undefined && Number.isFinite(value);
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

/* ───────────────────────────────────────────────────────────────── Feedback */

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

/* ────────────────────────────────────────────────────────────────── Callout */

export type CalloutTone = "info" | "caution" | "blocked" | "success";

const CALLOUT_ICON = {
  info: Info,
  caution: AlertTriangle,
  blocked: ShieldAlert,
  success: CheckCircle2,
} as const;

/**
 * A message with an icon AND text for every tone. Colour alone never carries
 * the meaning, so the amber and red variants remain distinguishable to a
 * colour-blind reader and in greyscale.
 */
export function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: CalloutTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = CALLOUT_ICON[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-card border p-3 text-sm",
        tone === "info" && "border-mist bg-[color-mix(in_srgb,var(--navy)_6%,var(--card))]",
        tone === "caution" && "border-amber/40 bg-[color-mix(in_srgb,var(--amber)_12%,var(--card))]",
        tone === "blocked" && "border-clay/40 bg-[color-mix(in_srgb,var(--clay)_8%,var(--card))]",
        tone === "success" &&
          "border-sprout/40 bg-[color-mix(in_srgb,var(--sprout)_10%,var(--card))]",
        className,
      )}
      role={tone === "blocked" || tone === "caution" ? "alert" : undefined}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "info" && "text-navy",
          tone === "caution" && "text-amber-ink",
          tone === "blocked" && "text-clay",
          tone === "success" && "text-forest",
        )}
      />
      <div className="min-w-0">
        {title ? <p className="font-semibold text-ink">{title}</p> : null}
        {children ? <div className="text-slate">{children}</div> : null}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────── UnknownValue */

/**
 * Renders a value the engine could not determine.
 *
 * Used instead of a dash or a zero so the distinction between "no risk" and
 * "we do not know" is visible. The optional reason is shown when the server
 * supplied one.
 */
export function UnknownValue({
  label,
  reason,
  className,
}: {
  label: string;
  reason?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-slate", className)}>
      <CircleHelp aria-hidden className="size-3.5 shrink-0" />
      <span className="text-sm">{label}</span>
      {reason ? <span className="text-xs">({reason})</span> : null}
    </span>
  );
}
