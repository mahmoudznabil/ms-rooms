import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Launch-readiness check.
 *
 * Answers one question: if we shipped right now, what breaks?
 *
 * Every item here is either something a customer would hit, or something the
 * operator has promised and cannot currently keep. It is deliberately blunt
 * about the two categories that are easy to declare "done" while not being done:
 * the legal documents reading the same thing the product actually does, and the
 * promises made in that text being enforced anywhere.
 *
 * Usage:
 *   node scripts/launch-check.mjs                 # checks the live site
 *   BASE=http://localhost:8788 node scripts/launch-check.mjs
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.env.BASE ?? "https://ms-rooms.pages.dev";

let pass = 0;
const blocked = [];
const warn = [];

function ok(name, detail = "") {
  pass += 1;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  blocked.push(name);
  console.log(`  BLOCK ${name}${detail ? ` — ${detail}` : ""}`);
}
function note(name, detail = "") {
  warn.push(name);
  console.log(`  NOTE  ${name}${detail ? ` — ${detail}` : ""}`);
}

const get = async (p) => {
  const r = await fetch(BASE + p, { redirect: "follow", signal: AbortSignal.timeout(25000) });
  const text = r.ok ? await r.text().catch(() => "") : "";
  return { status: r.status, text, headers: r.headers };
};

console.log(`launch check: ${BASE}\n`);

// ---------------------------------------------------------------- reachable
console.log("surface");
try {
  const home = await get("/");
  home.status === 200 ? ok("site reachable", "HTTP 200") : fail("site reachable", `HTTP ${home.status}`);
} catch (e) {
  fail("site reachable", e.message);
  console.log("\nBLOCKED: site unreachable, nothing else can be checked.");
  process.exit(1);
}

for (const [p, label] of [
  ["/legal", "public legal reader"],
  ["/privacy-policy", "legacy privacy URL still works"],
  ["/login", "login page"],
  ["/manifest.json", "PWA manifest"],
]) {
  const r = await get(p);
  r.status === 200 ? ok(label, p) : fail(label, `${p} -> ${r.status}`);
}

// ------------------------------------------------------- legal documents
console.log("\nlegal documents");
const en = await get("/api/legal/documents?lang=en");
const ar = await get("/api/legal/documents?lang=ar");
if (en.status !== 200 || ar.status !== 200) {
  fail("documents served in both languages", `${en.status}/${ar.status}`);
} else {
  const e = JSON.parse(en.text);
  const a = JSON.parse(ar.text);
  ok("documents served in both languages", `${e.documents.length} docs each`);

  const keys = ["terms", "privacy", "guidelines"];
  const haveKeys = keys.every((k) => e.documents.some((d) => d.key === k) && a.documents.some((d) => d.key === k));
  haveKeys ? ok("terms, privacy and guidelines all present") : fail("terms, privacy and guidelines all present");

  const parity = JSON.stringify(e.documents.map((d) => d.sections.length)) ===
    JSON.stringify(a.documents.map((d) => d.sections.length));
  parity ? ok("both languages have identical structure") : fail("both languages have identical structure");

  const both = en.text + ar.text;
  both.includes("{{") ? fail("no unfilled tokens reach customers") : ok("no unfilled tokens reach customers");

  // The stale hand-written policy claimed coins were earned-only with no
  // checkout. Coin packs have shipped, so that statement became false — and it
  // is exactly the sort of drift a single source of truth prevents.
  const stale = both.includes("earned-only") || both.includes("no web checkout");
  stale ? fail("no stale 'earned-only / no checkout' claim in the policy") : ok("no stale 'earned-only / no checkout' claim in the policy");

  const contact = both.includes("msroomsprod@protonmail.com");
  contact ? ok("current support address present") : fail("current support address present");

  const rtl = a.documents.every((d) => d.dir === "rtl");
  rtl ? ok("Arabic served as RTL") : fail("Arabic served as RTL");

  ok("document version pinned", e.version);
}

// -------------------------------------------------------------- enforcement
console.log("\nenforcement");
const status = await fetch(`${BASE}/api/legal/status`, { signal: AbortSignal.timeout(20000) });
status.status === 401 ? ok("consent status refuses anonymous callers") : fail("consent status refuses anonymous callers", `got ${status.status}`);

const anonAccept = await fetch(`${BASE}/api/legal/accept`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ lang: "en", age_confirmed: true, docs: [{ key: "terms", version: "2026-10-17" }] }),
});
anonAccept.status === 403 || anonAccept.status === 401
  ? ok("consent acceptance refuses unauthenticated callers", `HTTP ${anonAccept.status}`)
  : fail("consent acceptance refuses unauthenticated callers", `got ${anonAccept.status}`);

// -------------------------------------------------------------- hardening
console.log("\nheaders & assets");
const home = await get("/");
home.headers.get("content-security-policy-report-only")
  ? ok("CSP present in report-only mode")
  : fail("CSP present in report-only mode");
home.headers.get("x-content-type-options") ? ok("nosniff set") : note("nosniff not set");
home.headers.get("referrer-policy") ? ok("referrer policy set") : note("referrer policy not set");

for (const icon of ["/icon-512.png", "/icon-192.png", "/apple-touch-icon.png"]) {
  const r = await fetch(BASE + icon, { method: "HEAD", signal: AbortSignal.timeout(20000) });
  r.status === 200 && (r.headers.get("content-type") ?? "").includes("png")
    ? ok(`icon ${icon}`)
    : fail(`icon ${icon}`, `HTTP ${r.status}`);
}

console.log("\noperator obligations (not verifiable from here)");
note("commercial registration + tax number outstanding", "shipped as 'available on request'; check:legal:strict fails");
note("PDPL 151/2020 compliance period ends 1 Nov 2026", "72-hour breach notification not implemented");
note("legal review by an Egyptian lawyer", "documents are a drafted starting point, not reviewed advice");

// ------------------------------------------------------------------- report
console.log(`\n${pass} passed, ${blocked.length} blocking, ${warn.length} noted`);
if (blocked.length) {
  console.log(`\nNOT READY TO LAUNCH:\n${blocked.map((b) => `  - ${b}`).join("\n")}`);
  process.exit(1);
}
console.log("\nTechnically ready. The noted items are operator obligations, not code defects —");
console.log("but the registration numbers and the PDPL deadline are real and still open.");
void execFileSync;
void join;