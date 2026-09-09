"use client";

import type { DashboardRow } from "@/lib/api";
import { stressToken, stressWord } from "@/lib/utils";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

/**
 * Field markers on free OpenStreetMap raster tiles. No Mapbox token is needed,
 * which keeps the whole app runnable from an empty .env.
 */
export function StressMap({
  rows,
  onSelect,
}: {
  rows: DashboardRow[];
  onSelect?: (fieldId: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!container.current || map.current) return;

    map.current = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [78.9, 22.5],
      zoom: 3.9,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl({}), "top-right");
    map.current.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    // The map measures its container on creation, which in a grid can happen before
    // the final width is resolved. Without this it renders into part of the box.
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || rows.length === 0) return;

    for (const m of markers.current) m.remove();
    markers.current = [];

    const bounds = new maplibregl.LngLatBounds();

    for (const row of rows) {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute(
        "aria-label",
        `${row.field_name}, ${row.crop}, stress ${row.stress_level.toFixed(1)} out of 9, ${stressWord(row.stress_level)}`,
      );
      el.style.cssText = `
        width: 22px; height: 22px; border-radius: 999px; cursor: pointer;
        border: 2.5px solid var(--card);
        background: ${stressToken(row.stress_level)};
        box-shadow: 0 1px 3px rgba(20,24,26,0.35);
      `;
      el.addEventListener("click", () => onSelect?.(row.field_id));

      const popup = new maplibregl.Popup({ offset: 16, closeButton: false })
        .setHTML(
          `<div style="font-family: var(--font-sans); font-size: 13px; line-height:1.4">
             <strong>${escapeHtml(row.field_name)}</strong><br/>
             ${escapeHtml(row.farmer_name)}, ${escapeHtml(row.village)}<br/>
             <span style="color:#5A6165">${escapeHtml(row.crop)}, stress ${row.stress_level.toFixed(1)} of 9</span>
           </div>`,
        );

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([row.lon, row.lat])
        .setPopup(popup)
        .addTo(map.current);

      markers.current.push(marker);
      bounds.extend([row.lon, row.lat]);
    }

    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, { padding: 64, maxZoom: 7, duration: 0 });
    }
  }, [rows, onSelect]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={`Map of ${rows.length} monitored fields, coloured by current stress level`}
      className="h-[24rem] w-full overflow-hidden rounded-card border border-mist"
    />
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
