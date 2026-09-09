"use client";

/**
 * District stress overview.
 *
 * Two deliberate constraints:
 *
 * 1. MapLibre is imported dynamically inside an effect, so neither the library
 *    nor its CSS lands in the initial route bundle. It is a large dependency
 *    and most of this screen is readable without it.
 * 2. The map is an enhancement, never the only way to read the data. With
 *    `NEXT_PUBLIC_MAP_STYLE_URL` unset — which is its state today — the table
 *    is the whole feature and nothing throws. A tile provider outage degrades
 *    to the same table.
 *
 * Coordinates are coarsened to about a kilometre in both views. An agronomist
 * looking at a district overview has no need for a farm's surveyed position,
 * and rendering it precisely in a shared view discloses it for no benefit.
 */
import { Callout, Card, EmptyState, ErrorState, Skeleton, StressChip } from "@/components/ui";
import { useApiQuery } from "@/lib/api/query";
import { agronomist } from "@/lib/api/routes";
import { stressWord } from "@/lib/utils";
import { coarseCoordinate, narrowStressPoints, type NarrowedStressPoint } from "./narrow";
import { useEffect, useRef, useState } from "react";

function mapStyleUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  return url && url.trim() !== "" ? url : null;
}

export function StressMapPanel({ uid }: { uid: string | null }) {
  const query = useApiQuery(
    [uid, "agronomist", "stress-map"],
    (signal) => agronomist.stressMap({ signal, limit: 100 }),
    { enabled: Boolean(uid) },
  );

  if (query.isLoading) return <Skeleton className="h-64 w-full rounded-card" />;

  if (query.error) {
    return (
      <ErrorState
        title="Could not load the stress overview"
        message={query.error.message}
        onRetry={query.error.retryable ? query.refetch : undefined}
      />
    );
  }

  const points = narrowStressPoints(query.data);

  return (
    <section aria-labelledby="stress-heading" className="space-y-3">
      <h2 id="stress-heading" className="text-h3 font-semibold">
        Stress overview
      </h2>

      {points.length === 0 ? (
        <EmptyState
          title="No stress points"
          message="Once fields assigned to you have been evaluated, their stress levels appear here."
        />
      ) : (
        <>
          <MapCanvas points={points} />
          <StressTable points={points} />
        </>
      )}
    </section>
  );
}

/** The optional map. Renders an explanatory card instead when no style is
 *  configured, rather than an empty grey box. */
function MapCanvas({ points }: { points: NarrowedStressPoint[] }) {
  const styleUrl = mapStyleUrl();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!styleUrl || !containerRef.current) return;

    let cancelled = false;
    let map: { remove: () => void } | null = null;

    // Dynamic import keeps MapLibre out of the initial bundle.
    (async () => {
      try {
        // Both the library and its stylesheet are loaded here rather than at
        // module scope, so neither reaches the initial bundle and no global
        // CSS import is needed.
        const [maplibre] = await Promise.all([
          import("maplibre-gl"),
          import("maplibre-gl/dist/maplibre-gl.css"),
        ]);
        if (cancelled || !containerRef.current) return;

        const plotted = points.filter(
          (p) => p.latitude !== null && p.longitude !== null,
        );
        const first = plotted[0];

        const instance = new maplibre.Map({
          container: containerRef.current,
          style: styleUrl,
          center: first ? [first.longitude!, first.latitude!] : [78.96, 20.59],
          zoom: first ? 8 : 4,
          attributionControl: { compact: true },
        });

        for (const point of plotted) {
          const marker = document.createElement("div");
          marker.style.width = "14px";
          marker.style.height = "14px";
          marker.style.borderRadius = "50%";
          marker.style.border = "2px solid white";
          marker.style.background =
            point.stress === null ? "var(--mist)" : "var(--stress-moderate)";
          // Text, not colour alone: the marker's meaning must survive
          // greyscale and colour-blindness.
          marker.title =
            point.stress === null
              ? `Stress not known${point.missingReason ? `: ${point.missingReason}` : ""}`
              : `Stress ${point.stress.toFixed(1)} of 9 (${stressWord(point.stress)})`;
          new maplibre.Marker({ element: marker })
            .setLngLat([point.longitude!, point.latitude!])
            .addTo(instance);
        }

        map = instance;
      } catch {
        if (!cancelled) setFailed("The map could not be loaded.");
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [styleUrl, points]);

  if (!styleUrl) {
    return (
      <Callout tone="info" title="Map not configured">
        No map tile style is configured, so the overview is shown as the table below. Every field
        and its stress level is present there — the map would add geography, not data.
      </Callout>
    );
  }

  if (failed) {
    return (
      <Callout tone="caution" title="Map unavailable">
        {failed} The table below carries the same information.
      </Callout>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div ref={containerRef} className="h-[22rem] w-full" role="img" aria-label="Stress map" />
      <p className="border-t border-mist px-3 py-2 text-xs text-slate">
        Marker positions are approximate. The table below is the accessible equivalent.
      </p>
    </Card>
  );
}

/** The authoritative view: always rendered, map or no map. */
function StressTable({ points }: { points: NarrowedStressPoint[] }) {
  const unknownCount = points.filter((p) => p.stress === null).length;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-card border border-mist">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <caption className="sr-only">
            Stress by field, {points.length} rows, {unknownCount} with stress not known
          </caption>
          <thead className="bg-[color-mix(in_srgb,var(--mist)_35%,var(--card))]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate">
                Field
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate">
                Stress (0–9)
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate">
                Approx. location
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.fieldId} className="border-t border-mist">
                <td className="px-3 py-2 font-mono text-xs">{point.fieldId}</td>
                <td className="px-3 py-2">
                  {/* null must read as "not applicable", never as a zero bar. */}
                  <StressChip value={point.stress} notApplicableLabel="Not known" />
                  {point.stress === null && point.missingReason ? (
                    <span className="ml-2 text-xs text-slate">({point.missingReason})</span>
                  ) : null}
                </td>
                <td className="tabular px-3 py-2 text-xs text-slate">
                  {coarseCoordinate(point.latitude)}, {coarseCoordinate(point.longitude)}
                  {point.locationSource ? ` · ${point.locationSource}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate">
        Coordinates are rounded to roughly a kilometre. {unknownCount} of {points.length} fields
        have no stress value, which means it could not be determined rather than that stress is
        absent.
      </p>
    </div>
  );
}
