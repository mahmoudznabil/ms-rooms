import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unit-test harness.
 *
 * jsdom is the default environment because the signaling hooks under test touch
 * `document`, `AudioContext` and autoplay policy. Pure modules (levels, the
 * signaling decision kernels) run fine there too — they simply never touch the
 * DOM — so a single environment keeps the config honest and the suites
 * portable.
 *
 * `@/` mirrors the tsconfig `paths` mapping so tests import production modules
 * by the same specifier the app uses, never by relative path. If an import
 * works in the app it must work in the test, and vice versa.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    // Playwright owns tests/e2e — Vitest must not try to run those specs.
    exclude: ["node_modules/**", ".next/**", "out/**", "tests/e2e/**"],
    restoreMocks: true,
  },
});
