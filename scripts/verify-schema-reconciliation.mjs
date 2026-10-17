import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Verifies the schema reconciliation (migrations/0020_schema_reconciliation.sql).
 *
 * WHY A SCRIPT AND NOT A SQL ASSERT
 *
 * SQLite has no `ASSERT` and D1 has no procedural language, so a migration
 * cannot fail on its own conditions. The three rebuilds in 0020 therefore
 * `INSERT ... SELECT` with no row-count guard: a partial copy would succeed
 * silently. This script is the guard, and it must be run immediately after the
 * migration -- against preview first, then production.
 *
 * It checks four things the audit found, and one thing it did not:
 *
 *   1. gift_catalog has created_at
 *   2. admin_transactions.id is an INTEGER primary key with no NULLs
 *   3. pricing_tiers.bonus_percent is INTEGER NOT NULL
 *   4. pk_battles exists
 *   5. NO DATA WAS LOST -- row counts against a pre-migration baseline
 *
 * (5) is the one that matters. A schema fix that drops the ledger is not a fix.
 *
 * Usage:
 *   node scripts/verify-schema-reconciliation.mjs              # prod
 *   node scripts/verify-schema-reconciliation.mjs --local      # local
 *   BASELINE='{"gift_catalog":6,...}' node scripts/verify...  # pre-migration counts
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const wrangler = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

const LOCAL = process.argv.includes("--local");
const DB = process.env.D1_DATABASE ?? "audioroom-db";

function q(sql) {
  const out = execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", DB, ...(LOCAL ? ["--local"] : ["--remote"]), "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, cwd: repoRoot }
  );
  const i = out.indexOf("[");
  return JSON.parse(out.slice(i))[0]?.results ?? [];
}

let fail = 0;
let pass = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const target = LOCAL ? "local" : "PRODUCTION";
console.log(`schema reconciliation check (${target})\n`);

// 1 --------------------------------------------------------------------------
const giftCols = q(`SELECT name, type FROM pragma_table_info('gift_catalog')`);
const giftCreated = giftCols.find((c) => c.name === "created_at");
check(
  "1. gift_catalog.created_at present",
  !!giftCreated,
  giftCreated ? `type ${giftCreated.type}` : "column missing"
);

// 2 --------------------------------------------------------------------------
const atCols = q(`SELECT name, type, pk FROM pragma_table_info('admin_transactions')`);
const atId = atCols.find((c) => c.name === "id");
check(
  "2a. admin_transactions.id is INTEGER PRIMARY KEY",
  atId?.type?.toUpperCase() === "INTEGER" && String(atId?.pk) === "1",
  `type=${atId?.type} pk=${atId?.pk}`
);
const atNulls = q(`SELECT COUNT(*) AS n FROM admin_transactions WHERE id IS NULL`);
check("2b. admin_transactions has no NULL ids", Number(atNulls[0]?.n ?? 0) === 0, `nulls=${atNulls[0]?.n}`);

// 3 --------------------------------------------------------------------------
const ptCols = q(`SELECT name, type, "notnull" FROM pragma_table_info('pricing_tiers')`);
const ptBonus = ptCols.find((c) => c.name === "bonus_percent");
check(
  "3. pricing_tiers.bonus_percent is INTEGER NOT NULL",
  ptBonus?.type?.toUpperCase() === "INTEGER" && Number(ptBonus?.notnull) === 1,
  `type=${ptBonus?.type} notnull=${ptBonus?.notnull}`
);

// 4 --------------------------------------------------------------------------
const pk = q(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='pk_battles'`);
check("4. pk_battles exists", Number(pk[0]?.n ?? 0) === 1);

// 5 -- data preservation ------------------------------------------------------
const COUNTED = ["gift_catalog", "admin_transactions", "pricing_tiers", "users", "rooms", "transactions"];
const counts = {};
for (const t of COUNTED) {
  try {
    const r = q(`SELECT COUNT(*) AS n FROM ${t}`);
    counts[t] = Number(r[0]?.n ?? -1);
  } catch {
    counts[t] = -1;
  }
}

if (process.env.BASELINE) {
  let base;
  try {
    base = JSON.parse(process.env.BASELINE);
  } catch {
    console.log("  FAIL  BASELINE is not valid JSON");
    fail += 1;
    base = null;
  }
  if (base) {
    for (const [t, before] of Object.entries(base)) {
      const now = counts[t];
      check(`5. ${t} rows preserved`, now === Number(before), `before=${before} now=${now}`);
    }
  }
} else {
  console.log(`\n  note: no BASELINE supplied, so row preservation was NOT verified.`);
  console.log(`        counts now: ${JSON.stringify(counts)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);