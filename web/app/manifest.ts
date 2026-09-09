import type { MetadataRoute } from "next";

/**
 * Web app manifest, served by Next at /manifest.webmanifest.
 *
 * `display: standalone` plus a 192 and a 512 icon (and a maskable pair) is what
 * Chrome requires before it will offer installation at all.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AgriSense — biological application timing",
    short_name: "AgriSense",
    description:
      "Know the right morning to spray. Field-specific biological application timing, water planning and season records for Indian farms.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f6f7f5",
    theme_color: "#0b5d3b",
    categories: ["agriculture", "productivity", "utilities"],
    // Five languages ship, but the manifest itself can only declare one; the
    // in-app switcher remains the source of truth for language.
    lang: "en-IN",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
