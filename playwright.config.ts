import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
// localhost, not 127.0.0.1: Next 16 blocks cross-origin dev-resource (HMR)
// requests from 127.0.0.1 by default. Same loopback, no warning.
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Multi-client E2E harness.
 *
 * Audio-room testing is inherently multi-context: a single browser context
 * cannot hold two independent microphones or two independent WebRTC stacks. So
 * specs build N contexts and drive them in parallel — see
 * `tests/e2e/room-mesh.spec.ts`.
 *
 * Chromium is the only project. It is the only engine that lets a test grant a
 * fake-but-real microphone (`--use-fake-device-for-media-stream`) *and* expose
 * `webrtc-internals` counters and `chrome://webrtc-internals` style stats, which
 * is exactly what the room specs assert on. Firefox/WebKit coverage is a
 * deliberate follow-up, not an oversight.
 *
 * The web server is `next dev`, not the static export: dev gives us the Pages
 * Function shim and source maps. Set E2E_BASE_URL to point at a deployed
 * preview instead, and the local server is skipped.
 */
const useLocalServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // room specs share a signaling room id; serialize
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    launchOptions: {
      args: [
        // Deterministic mic input: a synthetic tone instead of silence, so
        // AnalyserNode levels actually move and VAD/speaking indicators can be
        // asserted instead of hoped for.
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: useLocalServer
    ? {
        // Explicit --webpack: Next 16 defaults to Turbopack, but this repo pins
        // webpack (see next.config.ts — Firebase singleton dedup) and the build
        // script already uses `next build --webpack`. Without the flag the dev
        // server refuses to start.
        command: `npm run dev -- --webpack --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
