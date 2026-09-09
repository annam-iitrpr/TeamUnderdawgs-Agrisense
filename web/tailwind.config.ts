import type { Config } from "tailwindcss";

/** Design tokens are declared as CSS custom properties in app/globals.css and
 * surfaced to Tailwind here, so a colour can be referenced either as a utility
 * class (bg-forest) or inside an arbitrary value (color-mix(... var(--forest))).
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forest: "var(--forest)",
        sprout: "var(--sprout)",
        navy: "var(--navy)",
        amber: "var(--amber)",
        "amber-ink": "var(--amber-ink)",
        clay: "var(--clay)",
        ink: "var(--ink)",
        slate: "var(--slate)",
        mist: "var(--mist)",
        paper: "var(--paper)",
        card: "var(--card)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
      fontSize: {
        display: ["2rem", { lineHeight: "2.375rem", fontWeight: "700" }],
        h1: ["1.5rem", { lineHeight: "1.875rem", fontWeight: "700" }],
        h2: ["1.25rem", { lineHeight: "1.625rem", fontWeight: "600" }],
        h3: ["1.0625rem", { lineHeight: "1.4375rem", fontWeight: "600" }],
        body: ["1rem", { lineHeight: "1.5rem" }],
      },
      borderRadius: {
        card: "14px",
        control: "10px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 12px rgba(16, 24, 40, 0.06)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        rise: "rise 180ms ease-out both",
        shimmer: "shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
