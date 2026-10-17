import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Catch the mojibake class permanently, in-repo.
 *
 * Two U+FFFD runs were found in shipped strings during a design review purely by
 * looking at rendered screenshots — a consent banner reading
 * "requiresthird-party cookies" and a mangled dash in the admin recharge panel.
 * Neither is catchable by the type checker or the test suite: the file is valid
 * UTF-8 and the bug exists only in the rendered output.
 *
 * What this checks:
 *
 *   1. U+FFFD in shipped source. Legitimate mentions inside comments about
 *      mojibake are excluded, so a real one in user-facing copy is unambiguous.
 *   2. The mirror-image case: a full replacement-character RUNE ("�") where an
 *      em dash, middle dot or arrow belongs. That is what the admin panel had,
 *      and it renders as a black diamond with a question mark.
 *
 * Exits non-zero on a hit so it can gate a release.
 */

const ROOTS = ["app", "components", "lib", "workers", "stores", "scripts", "migrations"];
const EXTS = new Set([".ts", ".tsx", ".mjs", ".sql", ".css", ".json"]);

/**
 * Comments are allowed to discuss the character; user-facing copy is not.
 *
 * The pattern has to tolerate hyphenation ("replacement-character") and this
 * file's own name, otherwise the checker reports itself and the signal is lost.
 */
const COMMENT_CONTEXT =
  /mojibake|replacement[\s-]?char|U\+FFFD|encoding|UTF-8|scan-|check-encoding/i;

const files = [];
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "out", ".next", ".wrangler", "backups", "tests"].includes(e)) continue;
      walk(p);
    } else if (EXTS.has(e.slice(e.lastIndexOf(".")))) {
      files.push(p);
    }
  }
}
ROOTS.forEach(walk);

const hits = [];

for (const f of files) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // Case 1: an explicit U+FFFD.
    if (line.includes("\uFFFD") && !COMMENT_CONTEXT.test(line)) {
      hits.push({ file: f, line: i + 1, kind: "U+FFFD", text: line.trim().slice(0, 100) });
    }
    // Case 2: a replacement-character RUNE, which is what actually shipped.
    const rune = line.match(/\u{FFFD}+/gu);
    if (rune && !COMMENT_CONTEXT.test(line)) {
      hits.push({ file: f, line: i + 1, kind: "rune", text: line.trim().slice(0, 100) });
    }
  });
}

console.log(`encoding check: scanned ${files.length} files\n`);

if (!hits.length) {
  console.log("clean — no replacement characters in shipped source");
  process.exit(0);
}

console.log(`${hits.length} hit(s):\n`);
for (const h of hits) {
  console.log(`  ${h.file}:${h.line}  [${h.kind}]`);
  console.log(`      ${h.text}\n`);
}
console.log("Replace with the intended character, or `npm run check:legal` for the");
console.log("mixed-script guard that covers the bilingual legal documents.");
process.exit(1);