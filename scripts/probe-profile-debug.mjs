import { chromium } from "@playwright/test";

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addCookies([{ name: "session", value: "sess_repro4", domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
p.on("response", (r) => {
  if (r.url().includes("/api/")) console.log(r.status(), r.url().replace("http://localhost:8794", ""));
});
await p.goto("http://localhost:8794/profile", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(8000);
console.log("COOKIES:", JSON.stringify(await ctx.cookies()));
console.log("VISIBLE:", ((await p.locator("body").innerText()) ?? "").slice(0, 300).replace(/\s+/g, " "));
await b.close();
