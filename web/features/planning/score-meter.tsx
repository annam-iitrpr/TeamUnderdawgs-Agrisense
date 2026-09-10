"use client";

/**
 * A score shown as ten segments rather than a bar and a percentage.
 *
 * Ten filled-or-empty marks can be counted at a glance and read without
 * numeracy, which a 0-100 figure cannot. The number is still shown for anyone
 * who wants it, but the segments carry the meaning.
 *
 * Colour is never the only signal: the count of filled segments says the same
 * thing, so the meaning survives colour blindness and a washed-out screen in
 * bright sun. An unknown score draws no segments at all — ten empty marks would
 * read as "nothing", which is a different claim from "not known".
 */
import { UnknownValue } from "@/components/ui";
import { cn } from "@/lib/utils";
import { explainCode } from "@/lib/missing-reasons";

const SEGMENTS = 10;

type Band = "strong" | "fair" | "weak";

function bandFor(filled: number): Band {
  if (filled >= 7) return "strong";
  if (filled >= 4) return "fair";
  return "weak";
}

const BAND_TEXT: Record<Band, string> = {
  strong: "Good fit",
  fair: "Workable",
  weak: "Poor fit",
};

const BAND_FILL: Record<Band, string> = {
  strong: "bg-forest",
  fair: "bg-amber",
  weak: "bg-clay",
};

export function ScoreMeter({
  score,
  label,
  missingReason,
  invertMeaning,
}: {
  score: number | null | undefined;
  label: string;
  missingReason?: string | null;
  /** For scales where more filled is better news but the wording differs. */
  invertMeaning?: { strong: string; fair: string; weak: string };
}) {
  if (score == null) {
    return (
      <div>
        <p className="text-xs text-slate">{label}</p>
        <div className="mt-1">
          <UnknownValue label="Not known" />
        </div>
        {missingReason ? (
          <p className="mt-0.5 text-xs text-slate">{explainCode(missingReason)}</p>
        ) : null}
      </div>
    );
  }

  const clamped = Math.min(1, Math.max(0, score));
  // At least one segment for any score above zero, so a small-but-real value is
  // never drawn as nothing at all.
  const filled = clamped === 0 ? 0 : Math.max(1, Math.round(clamped * SEGMENTS));
  const band = bandFor(filled);
  const wording = invertMeaning ? invertMeaning[band] : BAND_TEXT[band];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="text-xs text-slate">{label}</p>
        <p className="text-xs font-semibold text-ink">
          {wording} <span className="tabular-nums text-slate">{filled}/10</span>
        </p>
      </div>
      <div
        className="mt-1 flex gap-[3px]"
        role="meter"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={SEGMENTS}
        aria-valuetext={`${wording}, ${filled} out of ${SEGMENTS}`}
        aria-label={label}
      >
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <span
            key={index}
            aria-hidden
            className={cn(
              "h-2.5 flex-1 rounded-full transition-colors duration-200 motion-reduce:transition-none",
              index < filled ? BAND_FILL[band] : "bg-mist",
            )}
          />
        ))}
      </div>
    </div>
  );
}
