import { chromium } from "@playwright/test";

// Same as probe-delete-ui but parameterised by port via env.
const PORT = process.env.PROBE_PORT ?? "8796";
const BASE = `http://localhost:${PORT}`;

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addCookies([{ name: "session", value: "sess_repro4", domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
try {
  await p.getByText("Repro Four", { exact: false }).first().waitFor({ timeout: 15000 });
  console.log("PROFILE-RENDERED: true");
} catch {
  console.log("PROFILE-RENDERED: false");
}
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
  await p.waitForURL(`${BASE}/`, { timeout: 15000 });
  console.log("REDIRECT-HOME: true");
} catch {
  console.log("REDIRECT-HOME: false url=" + p.url());
}
console.log("PAGEERRORS:", errors.length === 0 ? "none" : errors.slice(0, 3));
await b.close();
