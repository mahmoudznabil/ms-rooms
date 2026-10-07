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
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const db = (process.env.D1_DATABASE ?? "audioroom-db").trim();
const bucket = (process.env.R2_BACKUP_BUCKET ?? "").trim();
const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-09-07T12-00-00
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "backups");
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `audioroom-db-${stamp}.sql`);

console.log(`Exporting "${db}" (remote)…`);
execFileSync(npx, ["wrangler", "d1", "export", db, "--remote", "--output", file], {
  stdio: "inherit",
});
if (!existsSync(file)) {
  console.error("Export did not produce a file.");
  process.exit(1);
}

if (bucket && accountId) {
  const key = `d1/audioroom-db-${stamp}.sql`;
  console.log(`Uploading to r2://${bucket}/${key} …`);
  execFileSync(npx, ["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", file], {
    stdio: "inherit",
  });
  console.log("Uploaded.");
} else {
  console.log("Skipping R2 upload (set R2_BACKUP_BUCKET and CLOUDFLARE_ACCOUNT_ID).");
}

console.log(`Backup complete: ${file}`);
