import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // jsdom only exposes localStorage/sessionStorage on a non-opaque origin.
    // Without an explicit URL the document origin is opaque and
    // window.localStorage is undefined, which the draft-persistence tests need.
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    // Installs an in-memory Storage, because Node 24's disabled experimental
    // localStorage global shadows jsdom's. See tests/setup.ts.
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/unit/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "tests/e2e"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
