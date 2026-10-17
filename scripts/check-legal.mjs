import { readFileSync } from "node:fs";
import process from "node:process";

/**
 * Lints lib/legal-documents.ts.
 *
 * TWO JOBS. Both exist because this file got them wrong once.
 *
 * 1. MIXED-SCRIPT DETECTION. The Arabic and English were generated together and
 *    the generation leaked fragments of other scripts into the Arabic — stray
 *    Latin tokens, and several runs of CJK. In ordinary prose that reads as
 *    corruption. In a legal document it is worse than cosmetic: these are the
 *    terms a customer accepts, and visibly broken Arabic in them undermines
 *    exactly the credibility the text depends on. Nothing else in the test
 *    suite would ever have caught it, so this does.
 *
 *    Every Arabic string is checked for Latin runs and CJK characters that are
 *    not on the allowlist of legitimate brand and standard names.
 *
 * 2. UNFILLED PLACEHOLDERS. `{{OPERATOR_LEGAL_NAME}}` and friends stand in for
 *    the operator's real company details. They are deliberately left
 *    unsubstituted rather than filled with invented values — a
 *    plausible-looking but false registered address or licence number is
 *    worse than an obvious gap, because it is harder to notice and it is still
 *    a false statement to a customer. An unfilled placeholder is an ERROR here
 *    so it cannot ship unnoticed.
 *
 * Run with `npm run check:legal`.
 */

const SRC = new URL("../lib/legal-documents.ts", import.meta.url);
const raw = readFileSync(SRC, "utf8");

/**
 * `--strict` promotes unfilled placeholders from a warning to a failure.
 *
 * The distinction is deliberate. A mixed-script defect is a bug in this
 * repository and must always fail. An unfilled `{{PLACEHOLDER}}` is not a bug —
 * it is a value only the operator can supply, and the app has to keep building
 * and running until they do. So the default run warns loudly and passes, and
 * the release gate (`npm run check:legal:strict`) refuses to let
 * placeholder text reach customers.
 */
const STRICT = process.argv.includes("--strict");

/**
 * Latin runs that legitimately appear inside Arabic text: brand and standard
 * names, and the word "version" in the versioned document heading. Anything
 * else in an `ar` string is a generation artefact.
 */
const ALLOWED_LATIN_IN_ARABIC = new Set([
  "MS-ROOMS",
  "GDPR",
  "CSRF",
  "IP",
  "Google",
  "Cloudflare",
  "cookies",
  "v",
]);

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
const LATIN_RUN = /[A-Za-z][A-Za-z0-9.'-]*/g;

/**
 * Mask the two things that legitimately look like Latin inside an Arabic
 * string: `{{PLACEHOLDER}}` markers and `${INTERPOLATION}` references.
 * Without this every placeholder reports as a mixed-script defect and the real
 * findings drown in noise.
 */
const maskCode = (s) => s.replace(/\{\{[A-Z_]+\}\}/g, "").replace(/\$\{[A-Z_]+\}/g, "");

const pairs = [...raw.matchAll(/en:\s*`([\s\S]*?)`,\s*\n?\s*ar:\s*`([\s\S]*?)`/g)];

const problems = [];
let checked = 0;

for (const m of pairs) {
  const ar = m[2];
  checked += 1;
  const line = raw.slice(0, m.index).split("\n").length;
  const masked = maskCode(ar);

  const cjk = masked.match(new RegExp(CJK, "g"));
  if (cjk) {
    problems.push({ line, kind: "cjk", detail: [...new Set(cjk)].join(" ") });
  }

  const latin = (masked.match(LATIN_RUN) ?? []).filter(
    (w) => !ALLOWED_LATIN_IN_ARABIC.has(w.replace(/\.$/, ""))
  );
  if (latin.length) {
    problems.push({ line, kind: "latin", detail: [...new Set(latin)].join(", ") });
  }

  if (!/[\u0600-\u06ff]/.test(ar)) {
    problems.push({ line, kind: "no-arabic", detail: "ar string has no Arabic letters" });
  }
}

const allPlaceholders = [...raw.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((x) => x[1]);
const placeholders = [...new Set(allPlaceholders)].sort();

console.log(`legal: checked ${checked} en/ar pairs in ${SRC.pathname.split("/").pop()}`);

if (problems.length) {
  console.log(`\nlegal: MIXED-SCRIPT PROBLEMS (${problems.length}):`);
  for (const p of problems) {
    console.log(`  line ${p.line} [${p.kind}] ${p.detail}`);
  }
}

if (placeholders.length) {
  const head = STRICT ? "ERROR" : "WARNING";
  console.log(`\nlegal: ${head}: ${placeholders.length} unfilled placeholder(s):`);
  for (const p of placeholders) {
    const n = allPlaceholders.filter((x) => x === p).length;
    console.log(`  {{${p}}} x${n}`);
  }
  if (!STRICT) {
    console.log(
      "  These stand in for the operator's real details and must be replaced\n" +
        "  before customers see this text. `npm run check:legal:strict` fails on them."
    );
  }
}

if (problems.length || (STRICT && placeholders.length)) {
  console.log("\nlegal: FAILED");
  process.exit(1);
}
console.log(
  problems.length === 0 && placeholders.length === 0
    ? "legal: OK — no mixed-script defects, all placeholders filled"
    : "legal: OK — no mixed-script defects"
);