import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Negative test for the authorization gate.
 *
 * A gate that cannot fail is decoration. This strips the actor resolution from
 * a real admin handler, confirms check-authorization.mjs reports it, then
 * restores the file and confirms it passes again.
 *
 * Run as: node scripts/verify-authorization-gate.mjs
 */

const SRC = "workers/backend.ts";
const BAK = "workers/backend.ts.gate-test-bak";

const before = readFileSync(SRC, "utf8");
copyFileSync(SRC, BAK);

const TARGET = 'if (path === "/api/admin/recharge/mark-paid"';
const idx = before.indexOf(TARGET);
if (idx === -1) {
  console.error(`could not find ${TARGET} — update TARGET in this script`);
  process.exit(1);
}

const segment = before.slice(idx, idx + 500);
const guard = segment.match(
  /[ \t]*const adm = await getAdminFromToken\(readAdminToken\(request\)\);\r?\n[ \t]*if \(!adm\)[^\n]*\r?\n/,
);
if (!guard) {
  console.error("could not locate the guard to remove — update this script");
  process.exit(1);
}

writeFileSync(SRC, before.slice(0, idx) + segment.replace(guard[0], "") + before.slice(idx + 500), "utf8");
console.log(`removed the admin guard from ${TARGET}\n`);

const { spawnSync: spawn } = { spawnSync };
const run = () =>
  spawn(process.execPath, ["scripts/check-authorization.mjs"], { encoding: "utf8" });

const broke = run();
const caught = broke.status !== 0 && /recharge\/mark-paid/.test(broke.stdout + broke.stderr);

console.log(`gate exit code: ${broke.status} (expected non-zero)`);
console.log(`gate named the endpoint: ${/recharge\/mark-paid/.test(broke.stdout + broke.stderr) ? "yes" : "NO"}`);
console.log((broke.stdout + broke.stderr).split("\n").filter((l) => l.includes("mark-paid")).join("\n"));

copyFileSync(BAK, SRC);
unlinkSync(BAK);

const fixed = run();
const passes = fixed.status === 0;

console.log(`\nrestored: gate exit code ${fixed.status} (expected 0) -> ${passes ? "pass" : "FAIL"}`);

if (!caught) {
  console.error("\nNEGATIVE TEST FAILED: the gate did not catch a removed guard.");
  process.exit(1);
}
if (!passes) {
  console.error("\nRESTORE FAILED: the gate does not pass on the unmodified file.");
  process.exit(1);
}
console.log("\ngate verified: it fails on a missing guard and passes when restored.");
