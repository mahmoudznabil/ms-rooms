import { readFileSync } from "node:fs";

/**
 * Authorization gate — fails the build when a route loses its actor check.
 *
 * This is the automated half of the 2026-10-18 route-by-route authorization
 * audit. That audit found five defects by hand across ~20 handlers:
 *
 *   /api/admin/customers/release  no ownership check (any admin could release
 *                                any other admin's customer)
 *   /api/admin/recharge/ledger   financial record readable by any admin role
 *   /api/admin/users             email/phone/firebase_uid to every admin role
 *   /api/users/:id/social        followed_by_viewer from an unauthenticated
 *                                ?viewer_id= parameter
 *   auth.ts requireAdmin         exported but unused, and wrong (Bearer only,
 *                                while the app authenticates by cookie)
 *
 * None of those were visible to tsc, eslint or the unit suite: the handlers are
 * type-correct whether or not they check the caller. This gate exists so the
 * next one is caught at review time rather than in production.
 *
 * WHAT IT CAN AND CANNOT PROVE
 *
 * It can prove a handler stopped RESOLVING AN ACTOR. It cannot prove the
 * ownership comparison is correct, that a role gate is on the right role, or
 * that an authorization decision happens at all — an inline `if` that is simply
 * missing from the known-public list reads the same as one that delegates to a
 * helper. So this is a floor, not a ceiling: it catches regressions and forces
 * a conscious decision for every new route, and it does not replace review.
 *
 * Adding a route to KNOWN_PUBLIC is a deliberate statement that the endpoint
 * serves data to anonymous callers. Do it by reasoning about the data, not to
 * silence this check.
 */

const SRC = "workers/backend.ts";
const src = readFileSync(SRC, "utf8");
const lines = src.split(/\r?\n/);

/** How the handler resolves who is calling. */
const ACTOR_RESOLUTION = [
  ["requireUser", /requireUser\s*\(/],
  ["sessionUserId", /sessionUserId\s*\(/],
  ["requireChatUser", /requireChatUser\s*\(/],
  ["requireSignalUser", /requireSignalUser\s*\(/],
  ["getAdminFromToken", /getAdminFromToken\s*\(/],
  ["requireAdmin", /requireAdmin\s*\(/],
];

/**
 * Endpoints that intentionally serve anonymous callers. Each entry is a claim
 * about the data being returned, not a formality.
 */
const KNOWN_PUBLIC = {
  // Firebase handshake — this is the credential exchange itself.
  "/api/auth/firebase": "exchanges a Firebase ID token for a session",
  "/api/auth/me": "returns the caller's own record; 401 when anonymous",
  "/api/csrf": "issues the CSRF token needed to make any other call",
  "/api/legal/documents": "the legal text is public by design",
  "/api/legal/status": "consent state for the caller; 401 when anonymous",
  "/api/legal/accept": "records consent for the caller; 401 when anonymous",
  "/api/pricing": "coin package prices, no user data",
  "/api/recaptcha/sitekey": "public site key",
  "/api/recaptcha/verify": "verifies a token against Google",
  "/api/csp-report": "browser-submitted CSP violation report",
  "/api/client-errors": "browser-submitted error report",
  "/api/rooms": "public room list, explicitly excludes private rooms",
  "/api/leaderboard": "public ranking",
  "/api/search": "public user search",
  "/api/users/check-username": "username availability probe",
  "/api/gifts": "public gift catalogue, no prices owned by a user",
  "/api/recharge/packages": "coin package catalogue",
  "/api/trivia/pack": "the current trivia pack, no user data",
  "/api/rewards/claim": "410 Gone deprecation stub; returns no data to anyone",
  "match(/^\\/api\\/users\\/([^/]+)$/)":
    "GET returns publicUser() allowlist only; the PATCH sibling resolves an actor",
  "match(/^\\/api\\/users\\/([^/]+)\\/profile$/)":
    "publicUser() allowlist plus aggregate follower/gift counts, no contact data",
  "/api/admin/login": "the admin login endpoint itself",
  "/api/admin/firebase": "admin Firebase handshake, like /api/auth/firebase",
  "/api/auth/logout": "clears a session; no data returned",
  "/api/admin/logout": "clears an admin session; no data returned",
};

/** Collect the real registration sites, in source order. */
const regs = [];
lines.forEach((line, i) => {
  let m;
  if ((m = line.match(/if \(path === "(\/api\/[^"]+)" && request\.method === "(\w+)"\)/))) {
    regs.push({ route: m[1], method: m[2], line: i, kind: "exact" });
  } else if ((m = line.match(/if \(path\.startsWith\("(\/api\/[^"]+)"\)/))) {
    regs.push({ route: m[1] + "/*", method: "ANY", line: i, kind: "prefix" });
  } else if ((m = line.match(/const (\w+) = path\.match\((.+)\);?/))) {
    regs.push({ route: `match(${m[2].replace(/\s+/g, " ").slice(0, 52)})`, method: "ANY", line: i, kind: "regex" });
  }
});
regs.sort((a, b) => a.line - b.line);

const findings = [];
let audited = 0;

regs.forEach((r, i) => {
  const end = i + 1 < regs.length ? regs[i + 1].line : lines.length;
  const body = lines.slice(r.line, end).join("\n");

  const resolvesActor = ACTOR_RESOLUTION.some(([, re]) => re.test(body));
  const base = r.route.replace(/\/\*$/, "");
  const isPublic = base in KNOWN_PUBLIC || r.route in KNOWN_PUBLIC;

  // Prefix registrations are routing branches, not endpoints; they legitimately
  // contain many handlers and are judged by those handlers, not themselves.
  if (r.kind === "prefix") return;

  audited++;
  if (!resolvesActor && !isPublic) {
    findings.push({ ...r, line: r.line + 1 });
  }
});

console.log(`authorization gate: ${regs.length} registrations, ${audited} endpoints audited\n`);

if (!findings.length) {
  console.log(`pass — every endpoint either resolves an actor or is in KNOWN_PUBLIC (${Object.keys(KNOWN_PUBLIC).length} entries)`);
  process.exit(0);
}

console.error(`${findings.length} endpoint(s) resolve no actor and are not in KNOWN_PUBLIC:\n`);
for (const f of findings) {
  console.error(`  ${f.route.padEnd(46)} ${f.method.padEnd(7)} ${SRC}:${f.line}`);
}
console.error(`\nEither add the route to KNOWN_PUBLIC with a reason, or add an actor`);
console.error(`resolution + ownership/role check. Do not add it to silence this.`);
process.exit(1);
