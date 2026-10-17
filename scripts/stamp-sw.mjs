import { readFileSync, writeFileSync } from "node:fs";

/**
 * Stamp the service worker with a build id so every deploy replaces it.
 *
 * THE BUG THIS FIXES
 *
 * `sw.js` is a static file that did not change between deploys. The browser
 * therefore never re-installed it, so the shell it cached at install time --
 * `/index.html` -- stayed frozen at whatever the user's first visit returned,
 * possibly weeks earlier.
 *
 * That matters because the shell references CONTENT-HASHED chunks. After a
 * deploy, Pages stops serving the old chunks. So a user who hit any failure on a
 * navigation (flaky network, offline, a proxy hiccup) got the offline fallback
 * path, which served that frozen shell -- pointing at chunks that no longer
 * exist. The result is a stale UI or a blank page.
 *
 * It is also why a design change could be deployed, verified in the build, and
 * still not appear for a returning user.
 *
 * THE FIX
 *
 * `public/sw.js` declares `const BUILD_ID = "__BUILD_ID__";` and names its cache
 * `msrooms-shell-${BUILD_ID}`. This script runs after `next build` and substitutes
 * a real id derived from the output directory's contents, so the bytes of the
 * service worker change whenever the app changes -- which is precisely when the
 * browser must be told to drop the cached shell and re-cache it.
 *
 * Derived from a hash of `out/`, not from git, so it also changes when someone
 * edits `public/sw.js` itself or any static asset without touching a commit.
 */

const SW = "public/sw.js";
const sw = readFileSync(SW, "utf8");

// Deterministic content hash of the built output. Node's crypto is enough and
// avoids pulling in a dependency for one hash.
const { createHash } = await import("node:crypto");
const { readdirSync, statSync } = await import("node:fs");
const { join } = await import("node:path");

const h = createHash("sha256");
(function walk(dir) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (!p.endsWith("sw.js")) {
      // sw.js is excluded because it is the file being written; including it
      // would make the id depend on its own output.
      h.update(e);
      h.update(String(statSync(p).size));
    }
  }
})("out");
const buildId = h.digest("hex").slice(0, 12);

if (!sw.includes('"__BUILD_ID__"')) {
  console.error("public/sw.js does not contain the __BUILD_ID__ placeholder.");
  console.error("Add:  const BUILD_ID = \"__BUILD_ID__\";  and use it in the cache name.");
  process.exit(1);
}

// Stamp the BUILT copy, not the source.
//
// An earlier version wrote back to public/sw.js, which made stamping
// non-idempotent: the second build found no placeholder left to substitute and
// failed. Mutating the source also meant the repo no longer matched what it
// claimed to contain, and a `git diff` after every build showed a change that
// was not a change.
//
// Next.js copies public/* into out/, so out/sw.js is the file that actually
// ships. Overwriting it leaves the source pristine and makes this safe to run
// any number of times.
const BUILT = "out/sw.js";
writeFileSync(BUILT, sw.replaceAll("__BUILD_ID__", buildId), "utf8");
console.log(`stamped out/sw.js with build id ${buildId}`);