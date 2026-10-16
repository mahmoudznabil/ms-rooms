import { chromium } from "@playwright/test";

// UI-level account deletion: drives the real profile page buttons with a
// seeded session. Verifies the CSRF fix end to end (button -> confirm ->
// redirect home), not just the API.
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addCookies([{ name: "session", value: "sess_repro4", domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto("http://localhost:8795/profile", { waitUntil: "domcontentloaded" });
try {
  await p.getByText("Repro Four", { exact: false }).first().waitFor({ timeout: 15000 });
  console.log("PROFILE-RENDERED: true");
} catch {
  console.log("PROFILE-RENDERED: false");
}
// Profile must STAY rendered past the admin role-check 401 (boot-out guard).
await p.waitForTimeout(6000);
try {
  await p.getByText("Repro Four", { exact: false }).first().waitFor({ timeout: 5000 });
  console.log("PROFILE-STABLE: true");
} catch {
  console.log("PROFILE-STABLE: false");
}
await p.getByRole("button", { name: /delete account/i }).click();
await p.getByRole("button", { name: /yes, delete my account/i }).click();
try {
  await p.waitForURL("http://localhost:8795/", { timeout: 15000 });
  console.log("REDIRECT-HOME: true");
} catch {
  console.log("REDIRECT-HOME: false url=" + p.url());
}
console.log("PAGEERRORS:", errors.length === 0 ? "none" : errors.slice(0, 3));
await b.close();
