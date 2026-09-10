"use client";

/**
 * "How AgriSense helps", as a thing you can read rather than a thing you enter.
 *
 * This copy used to exist only inside the onboarding consent step, so the only
 * route to it was `/onboarding` — which starts the flow, mints a fresh draft and
 * therefore *resets* an onboarding a farmer had already part-finished. Reading
 * an explanation must not cost anyone their answers, so the words live here and
 * both the consent step and the dashboard render them in place.
 *
 * The claims are deliberately the modest ones the app can actually keep: it
 * names a window and its reasons, and it records what happened. It does not
 * promise a yield.
 */
import { Button } from "@/components/ui";
import { HelpCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

/** The explainer itself. Callers supply their own surface. */
export function HowAgriSenseHelps() {
  return (
    <div className="space-y-3 text-sm text-slate">
      <p className="text-ink">
        AgriSense tells you the best window to apply a biological product on your field, why
        that window, and what it is worth — then keeps a record of your season.
      </p>
      <p>
        To do that it needs your field&apos;s location and a few details about your crop. Your
        location is kept at field level, not household level.
      </p>
      <dl className="space-y-2.5">
        <div>
          <dt className="font-semibold text-ink">It reads the conditions</dt>
          <dd>
            The weather forecast for your field, the stage your crop has reached, and the soil
            underneath it.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">It names a window, with its reasons</dt>
          <dd>
            You see why a morning is good or bad, not only a score. When something it needs is
            missing it says so instead of filling the gap with a typical figure.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">It keeps your season</dt>
          <dd>
            What you watered, sprayed and harvested stays in your journal, so at the end of the
            season the advice can be checked against what actually happened.
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The same explainer as a modal.
 *
 * A modal rather than a route because this is a detour: a farmer reads it and
 * returns to whatever they were doing, with nothing behind them reset.
 */
export function HowAgriSenseHelpsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Escape closes, and focus starts on the way out rather than somewhere a
    // keyboard user has to hunt for.
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)}>
        <HelpCircle aria-hidden className="size-4" />
        How AgriSense helps
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-agrisense-helps-title"
            className="max-h-[85dvh] w-full max-w-[34rem] overflow-y-auto rounded-card border border-mist bg-card p-5"
            // The backdrop closes; the panel itself must not, or every tap on
            // the text a farmer is reading would dismiss it.
            onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="how-agrisense-helps-title" className="text-h2 font-semibold">
                How AgriSense helps
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid size-9 shrink-0 place-items-center rounded-control border border-mist text-slate"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <div className="mt-3">
              <HowAgriSenseHelps />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
