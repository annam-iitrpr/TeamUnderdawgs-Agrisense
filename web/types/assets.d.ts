/**
 * Ambient declarations for non-code imports.
 *
 * Next.js handles a bare `.css` import from a package at build time, but
 * TypeScript has no declaration for one, so `import "maplibre-gl/dist/
 * maplibre-gl.css"` fails typecheck without this.
 *
 * The MapLibre stylesheet is not optional decoration: it styles the attribution
 * and zoom controls, and tile providers generally require their attribution to
 * be visible. Dropping the import to satisfy the compiler would quietly create
 * a licensing problem, so the declaration is the right fix.
 */
declare module "*.css";
