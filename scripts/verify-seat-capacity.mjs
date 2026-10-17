#!/usr/bin/env node
/**
 * F4 verification: does the seat grid the UI draws match what the room policy
 * (rooms.capacity) actually permits?
 *
 * Before the fix, seat endpoints hardcoded `seatIndex > 7`, so a room with
 * capacity 12 drew twelve seats and refused every one past the eighth. This
 * script reports the drift in the live database so we know whether any room is
 * currently affected.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DB = process.env.D1_DB ?? "audioroom-db";
const REMOTE = process.env.D1_REMOTE !== "0";

// Invoke wrangler's JS entry with the current Node binary rather than going
// through `npx`. Two Windows problems avoided at once: `npx` is a .cmd shim
// that execFileSync cannot spawn without a shell, and a shell spawn re-splits
// the SQL on spaces into separate argv entries.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const wranglerBin = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function q(sql) {
  // --command (not --file) because the shell is out of the loop here: wrangler is
  // invoked as `node wrangler.js ...`, so argv reaches it verbatim and the SQL
  // keeps its spaces and quotes. Going through --file instead makes wrangler
  // upload the temp file first, which injects a banner and returns only a
  // query summary rather than rows.
  const out = execFileSync(
    process.execPath,
    [
      wranglerBin,
      "d1",
      "execute",
      DB,
      ...(REMOTE ? ["--remote"] : ["--local"]),
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, cwd: repoRoot }
  );
  try {
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed)) return parsed[0]?.results ?? [];
    if (parsed && Array.isArray(parsed.results)) return parsed.results;
    return [];
  } catch (e) {
    throw new Error(`Could not parse wrangler --json output: ${e.message}\n${out.slice(0, 400)}`);
  }
}

const LEGACY_SEAT_LIMIT = 8; // what the old hardcoded guard allowed

const caps = q("SELECT COALESCE(capacity, -1) AS cap, COUNT(*) AS n FROM rooms GROUP BY cap");
console.log("rooms.capacity distribution:");
for (const r of caps ?? []) console.log(`  capacity=${r.cap}  rooms=${r.n}`);

const over = q(
  `SELECT r.id AS room_id, r.title, r.capacity AS cap, MAX(s.seat_index) AS mx, COUNT(*) AS seats
     FROM seats s JOIN rooms r ON r.id = s.room_id
    WHERE s.seat_index >= ${LEGACY_SEAT_LIMIT}
    GROUP BY r.id
    ORDER BY mx DESC`
);
console.log(`\nseats at or beyond the old limit of ${LEGACY_SEAT_LIMIT}: ${(over ?? []).length}`);
for (const r of over ?? []) {
  const blocked = Number(r.mx) >= LEGACY_SEAT_LIMIT;
  console.log(
    `  ${r.room_id} "${r.title}" capacity=${r.cap} maxSeat=${r.mx} rows=${r.seats}` +
      (blocked ? "  <-- UNREACHABLE under the old guard" : "")
  );
}

// Rooms that claim more seats than could ever be taken.
const capacityAboveLegacy = q(
  `SELECT id, slug, title, capacity FROM rooms WHERE capacity > ${LEGACY_SEAT_LIMIT}`
);
console.log(`\nrooms with capacity > ${LEGACY_SEAT_LIMIT}: ${(capacityAboveLegacy ?? []).length}`);
for (const r of capacityAboveLegacy ?? []) {
  console.log(`  ${r.slug} "${r.title}" capacity=${r.capacity}`);
}

// Orphans: seats above the capacity of the room that owns them.
const orphans = q(
  `SELECT s.room_id, s.seat_index, r.capacity
     FROM seats s JOIN rooms r ON r.id = s.room_id
    WHERE s.seat_index >= r.capacity`
);
console.log(`\nseats beyond their own room's capacity: ${(orphans ?? []).length}`);
for (const r of (orphans ?? []).slice(0, 20)) {
  console.log(`  room=${r.room_id} seat=${r.seat_index} capacity=${r.capacity}`);
}

const bad =
  (over ?? []).filter((r) => Number(r.mx) >= LEGACY_SEAT_LIMIT).length > 0 ||
  (orphans ?? []).length > 0;
console.log(`\nRESULT: ${bad ? "DRIFT FOUND (see above)" : "no drift — every seat is reachable"}`);
process.exit(0);