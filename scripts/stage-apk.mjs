import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";

/**
 * Stage an Android APK for direct distribution.
 *
 * The APK is deliberately not committed: it is a large binary produced by a
 * build that does not run in CI, and a stale committed APK is worse than none.
 * Instead this script copies it into public/downloads/ and writes a checksum
 * sidecar, and the landing page discovers it at runtime with a HEAD request.
 *
 * Usage:
 *   npm run stage:apk -- path/to/app-release.apk
 *
 * Produces:
 *   public/downloads/ms-rooms.apk
 *   public/downloads/ms-rooms.apk.sha256
 *
 * The checksum matters more here than for a Play download. Asking a user to
 * enable "install unknown apps" in their browser is a real security decision,
 * and a published hash is what lets them make it with evidence instead of on
 * trust. The landing page shows it for exactly that reason.
 *
 * The output name is fixed so the URL in MobileDownload.tsx does not change
 * between releases. Caching is left to Cloudflare, which revalidates after a
 * deploy.
 */

const APK_DIR = "public/downloads";
const APK_NAME = "ms-rooms.apk";
const SHA_NAME = `${APK_NAME}.sha256`;

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run stage:apk -- <path-to-apk>");
  console.error("   or: npm run stage:apk -- --clear   (remove a staged build)");
  process.exit(1);
}

// --clear: take the download back down without deleting the code.
if (arg === "--clear") {
  for (const f of [`${APK_DIR}/${APK_NAME}`, `${APK_DIR}/${SHA_NAME}`]) {
    if (existsSync(f)) {
      unlinkSync(f);
      console.log(`removed ${f}`);
    }
  }
  console.log("download button will report 'not released yet' after the next deploy.");
  process.exit(0);
}

if (!existsSync(arg)) {
  console.error(`not found: ${arg}`);
  process.exit(1);
}

/**
 * Reject anything that is not an APK before it reaches the download button.
 *
 * An APK is a ZIP, so the first two bytes are "PK". Checking this catches the
 * realistic failure — pointing the script at a debug log, a renamed HTML file,
 * or the wrong artefact out of a build directory — which would otherwise be
 * published as "the official app" and produce an install failure nobody can
 * diagnose.
 */
const head = readFileSync(arg).subarray(0, 2);
if (head[0] !== 0x50 || head[1] !== 0x4b) {
  console.error(`not a ZIP/APK (missing PK magic): ${basename(arg)}`);
  console.error("point this at the release .apk, not a log or a renamed file.");
  process.exit(1);
}

const bytes = readFileSync(arg);
const sha = createHash("sha256").update(bytes).digest("hex");

mkdirSync(APK_DIR, { recursive: true });
copyFileSync(arg, `${APK_DIR}/${APK_NAME}`);
writeFileSync(`${APK_DIR}/${SHA_NAME}`, `${sha}\n`, "utf8");

const mb = (statSync(`${APK_DIR}/${APK_NAME}`).size / (1024 * 1024)).toFixed(1);
console.log(`staged ${basename(arg)} -> ${APK_DIR}/${APK_NAME} (${mb} MB)`);
console.log(`sha256 ${sha}`);
console.log("\nNext: npm run build, then deploy. The button appears on the landing page.");
console.log("Keep this commit out of git — build artifacts do not belong in the repo.");
