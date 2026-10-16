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
    // jsdom boot is the expensive part here (a full DOM + layout engine per
    // file), and the suites that render React components (minigame-panel)
    // blow past the 500ms default on slower CI/dev boxes. Raising these keeps
    // a genuinely slow environment from being misread as a hung worker.
    environmentTimeout: 300_000,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Worker isolation routes every RPC (including "set up this file's jsdom
    // environment") through a birpc channel whose timeout is hardcoded to 5s.
    // This box takes ~70s to boot jsdom, so the channel times out and Vitest
    // reports "Timeout calling fetch" before a single test runs — no CLI flag
    // or config option raises it. Running unisolated drops the worker channel
    // and does the setup in-process. The suites here are self-contained (each
    // builds its own DOM and mocks), so there is no cross-file state to leak.
    isolate: false,
  },
});
