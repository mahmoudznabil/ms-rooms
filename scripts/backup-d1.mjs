#!/usr/bin/env node
// Exports the D1 database to a timestamped SQL file and, when R2_BACKUP_BUCKET
// and CLOUDFLARE_ACCOUNT_ID are set, uploads it to an R2 bucket for offsite
// retention. Intended for local use and for the scheduled GitHub Action
// (.github/workflows/backup.yml).
//
// Requirements:
//   - wrangler authenticated (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
//   - an R2 bucket named in R2_BACKUP_BUCKET (create it once, keep it separate
//     from the chat-attachments bucket)
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const db = (process.env.D1_DATABASE ?? "audioroom-db").trim();
const bucket = (process.env.R2_BACKUP_BUCKET ?? "").trim();
const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();

/**
 * Invoke wrangler through the current Node binary rather than through `npx`.
 *
 * `npx` is a `.cmd` shim on Windows, and `execFileSync` cannot spawn one without
 * a shell (`spawnSync npx.cmd EINVAL`). Adding `shell: true` is not a fix -- it
 * re-splits arguments on spaces, which corrupts paths. Calling wrangler's JS
 * entry directly passes argv verbatim on every platform.
 *
 * This was not a Windows-only annoyance: the scheduled backup workflow
 * (.github/workflows/backup.yml) runs this same file, so on any runner where
 * `npx` was not a resolvable executable the nightly backup exited before
 * writing anything. A backup that silently produces no file is worse than one
 * that fails loudly, so the result is also size-checked below.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function wranglerArgs(args) {
  return execFileSync(process.execPath, [wrangler, ...args], {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-09-07T12-00-00
const outDir = path.resolve(repoRoot, "backups");
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `audioroom-db-${stamp}.sql`);

console.log(`Exporting "${db}" (remote)…`);
wranglerArgs(["d1", "export", db, "--remote", "--output", file]);
if (!existsSync(file)) {
  console.error("Export did not produce a file.");
  process.exit(1);
}
// An export that writes nothing still exits 0. Treat that as a failure, or the
// schedule reports success while holding no data.
const bytes = statSync(file).size;
if (bytes < 1024) {
  console.error(`Export produced only ${bytes} bytes — treating as a failed backup.`);
  process.exit(1);
}

if (bucket && accountId) {
  const key = `d1/audioroom-db-${stamp}.sql`;
  console.log(`Uploading to r2://${bucket}/${key} …`);
  wranglerArgs(["r2", "object", "put", `${bucket}/${key}`, "--file", file]);
  console.log("Uploaded.");
} else {
  console.log("Skipping R2 upload (set R2_BACKUP_BUCKET and CLOUDFLARE_ACCOUNT_ID).");
}

console.log(`Backup complete: ${file} (${Math.round(bytes / 1024)} KB)`);
