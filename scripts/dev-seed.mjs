import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Seed a LOCAL test account and hand back a session cookie.
 *
 * WHY THIS EXISTS
 *
 * Identity runs through Firebase, so there is no offline way to sign up: the
 * signup endpoint requires a real Firebase ID token, and minting one locally is
 * not possible. That left the entire authenticated surface untestable — the
 * rooms, seats, chat, wallet and admin desk could only be exercised by hand in
 * a browser.
 *
 * But `requireUser` does not care where the session came from. It reads the
 * `session` cookie and looks the row up in the `sessions` D1 table. So seeding
 * that table directly is equivalent to having signed in, and it is the same
 * code path the real login lands on. No auth code is bypassed or forked.
 *
 * SCOPE — LOCAL ONLY, ENFORCED
 *
 * Refuses to run against a remote database. Seeding a synthetic identity into
 * production would put a fabricated account into the member list and the admin
 * customer desk, and would mean asserting "I am 18 or over" in a system that
 * now records that assertion as a legal record against somebody who never made
 * it. That is not a trade worth making for a convenience script.
 *
 * USAGE
 *
 *   npm run dev:seed                 # a normal user
 *   npm run dev:seed -- --admin      # an admin user (role in admin_users)
 *   npm run dev:seed -- --id tester2 # choose the user id
 *
 * Then drive the app with:
 *
 *   curl -H "Cookie: session=<printed token>" http://localhost:8788/api/auth/me
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const wrangler = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

/** Remote is refused outright; see the note above. */
const argv = process.argv.slice(2);
if (argv.includes("--remote")) {
  console.error("dev:seed refuses to touch a remote database.");
  process.exit(1);
}

const isAdmin = argv.includes("--admin");
const idIdx = argv.indexOf("--id");
const userId = (idIdx !== -1 && argv[idIdx + 1]) || (isAdmin ? "dev-admin" : "dev-user");

const coins = isAdmin ? 5000 : 1000;

// `id_tag` carries a UNIQUE constraint, so it cannot be a fixed literal across
// seeds — seeding two accounts collided on it. Derived from the user id
// instead, matching the shape the real signup path produces.
const idTag = `${userId.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "DEV"}#DEV`;

function sql(statement) {
  return execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", "audioroom-db", "--local", "--command", statement],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, cwd: repoRoot }
  );
}

// Random, so concurrent seeds do not collide and no token is guessable.
//
// The admin token MUST start with "admin_": `getAdminFromToken` rejects anything
// else before it even queries, so a conventionally-named token silently fails to
// authenticate. Matching the shape `/api/admin/login` mints.
const sessionToken = `sess_dev_${randomBytes(24).toString("hex")}`;
const adminToken = `admin_dev_${randomBytes(24).toString("hex")}`;

console.log(`seeding local account "${userId}"${isAdmin ? " (admin)" : ""}...`);

sql(
  `INSERT INTO users (id, username, display_name, avatar_url, frame_style, id_tag, email, phone,
      firebase_uid, provider, bio, coins, xp, streak)
   VALUES ('${userId}', '${userId}', '${isAdmin ? "Dev Admin" : "Dev User"}', NULL,
      'default', '${idTag}', '${userId}@example.test', NULL,
      'dev-${userId}', 'dev', 'Local development account.', ${coins}, 100, 3)
   ON CONFLICT(id) DO UPDATE SET coins = excluded.coins`
);

sql(`INSERT OR IGNORE INTO sessions (id, user_id, expires_at) VALUES ('${sessionToken}', '${userId}', datetime('now', '+30 days'))`);

// Admin access is a separate identity from a user account: `requireAdmin` reads
// an `admin_session` joined to `admin_users`, not the user session above. So an
// admin needs BOTH — a user row (to be in the product) and an admin identity
// (to reach the admin desk).
if (isAdmin) {
  sql(
    `INSERT OR IGNORE INTO admin_users (id, username, display_name, role, password_hash)
     VALUES ('${userId}', '${userId}', 'Dev Admin', 'master_admin', 'dev-only-no-login')
        ON CONFLICT(id) DO UPDATE SET role = 'master_admin'`
  );
  sql(
    `INSERT OR IGNORE INTO admin_sessions (id, admin_id, role, expires_at)
     VALUES ('${adminToken}', '${userId}', 'master_admin', datetime('now', '+1 day'))`
  );
}

console.log("\nseeded.");
console.log(`  user id    ${userId}`);
console.log(`  coins      ${coins}`);
console.log(`  admin      ${isAdmin}`);
console.log(`\n  user cookie:  session=${sessionToken}`);
if (isAdmin) console.log(`  admin cookie: admin_session=${adminToken}`);
console.log("");

// Confirm the seeded session actually authenticates, so a failure here is loud
// rather than surfacing later as a mysterious 401.
try {
  const check = sql(
    `SELECT s.user_id, s.expires_at, u.coins FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = '${sessionToken}'`
  );
  const ok = check.includes(userId);
  console.log(`  verified   ${ok ? "session resolves to the user" : "SESSION DID NOT RESOLVE"}`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error(`  verify failed: ${e.message}`);
  process.exitCode = 1;
}