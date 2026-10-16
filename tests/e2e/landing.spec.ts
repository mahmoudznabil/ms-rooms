import { expect, test } from "@playwright/test";

/**
 * Landing + route-gate smoke.
 *
 * No auth, no backend writes. Signed-out visitors see the public landing page
 * at `/`, and protected routes (e.g. `/lobby`) render the login gate instead
 * of leaking the app. If either breaks, the failure is in routing — not in
 * media — so this spec stays deliberately free of WebRTC assertions (those
 * live in `room-mesh.spec.ts`).
 */
test.describe("landing and route gate", () => {
  test("signed-out visitor sees the public landing page", async ({ page }) => {
    await page.goto("/");
    // Landing advertises the stage; the exact copy may evolve, so assert on
    // stable, structural content rather than marketing sentences.
    await expect(page.getByRole("heading", { name: /eight seats, one stage/i })).toBeVisible();
  });

  test("protected route renders the login gate when signed out", async ({ page }) => {
    await page.goto("/lobby");
    // AppShell renders LoginView for non-public paths when there is no session.
    await expect(page.getByRole("heading", { name: /welcome back|sign in|log in/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
