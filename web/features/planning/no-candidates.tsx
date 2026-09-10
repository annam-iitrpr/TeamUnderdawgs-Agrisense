"use client";

/**
 * Why nothing came back from a comparison.
 *
 * The engine's own exclusion codes drive this rather than a single empty state,
 * because "your field is fully assigned" and "no reviewed data for your region"
 * need completely different actions from the farmer — one is something they can
 * fix in a minute, the other is not their problem at all.
 *
 * Shared by the planner screen and the onboarding crop step so a farmer is told
 * the same thing in both places.
 */
import { Callout } from "@/components/ui";
import type { CropComparison } from "@/lib/api/contract";
import type { ReactNode } from "react";

export function NoCandidates({
  comparison,
  fieldName,
  nameFor,
  footer,
}: {
  comparison: CropComparison | null;
  fieldName: string;
  /** Turns a crop id into its catalogue name; falls back to the id. */
  nameFor?: (cropId: string) => string;
  /** What the farmer can do next, which differs by where this is shown. */
  footer?: ReactNode;
}) {
  const exclusions = comparison?.exclusions ?? [];
  const fullyAllocated = exclusions.some((e) => e.code === "no_unallocated_area");
  const noRegionalData = exclusions.some(
    (e) => e.code === "reviewed_regional_crop_reference_missing",
  );

  if (fullyAllocated) {
    return (
      <Callout tone="info" title="This field is fully assigned">
        <p>
          Every hectare of {fieldName} already belongs to a season, so there is no area left to
          plan for. Close a season, or reduce the area it uses, and then come back.
        </p>
        {footer}
      </Callout>
    );
  }

  if (noRegionalData) {
    // The engine names the crop it could not score in `facts.crop_id`, so each
    // one is listed by name. Five identical unnamed lines tell a farmer nothing.
    const crops = exclusions
      .filter((e) => e.code === "reviewed_regional_crop_reference_missing")
      .map((e) => String((e.facts as Record<string, unknown>)?.crop_id ?? ""))
      .filter(Boolean)
      .map((id) => nameFor?.(id) ?? id);
    return (
      <Callout tone="caution" title="No reviewed data for your area yet">
        <p>
          AgriSense has the weather for {fieldName} but not the reviewed agronomic records it
          needs to score {crops.length > 0 ? crops.join(", ") : "these crops"} here. It will not
          rank crops on a guess, so nothing is shown rather than a made-up score.
        </p>
        <p className="mt-2 text-sm">
          Suitability, water and return appear here as soon as the reviewed data for your
          district is published.
        </p>
        {footer}
      </Callout>
    );
  }

  return (
    <Callout tone="caution" title="No crop can be compared for this field yet">
      <p>
        AgriSense will not rank crops without reviewed records for your area, because a
        suitability score with nothing behind it would be a guess dressed up as advice.
      </p>
      {exclusions.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-sm">
          {/* Keyed by position: the same code legitimately repeats once per crop. */}
          {exclusions.slice(0, 5).map((reason, index) => (
            <li key={`${reason.code}-${index}`}>{reason.code.replace(/_/g, " ")}</li>
          ))}
        </ul>
      ) : null}
      {footer}
    </Callout>
  );
}
