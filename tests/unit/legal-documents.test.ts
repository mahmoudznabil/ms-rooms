import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCUMENTS,
  LEGAL_LANGS,
  LEGAL_VERSION,
  MINIMUM_AGE,
  REQUIRED_LEGAL_DOCS,
  getLegalDocument,
  isLegalCleared,
  isLegalLang,
  legalDocSummaries,
  missingLegalDocs,
  renderLegalDocument,
  type AcceptedRecord,
} from "@/lib/legal-documents";

/**
 * The legal gate is the one thing in this product that can lock a customer out
 * of an account they have already paid for, so the rule is pinned here rather
 * than left to whichever handler happens to check it.
 *
 * Two properties are load-bearing and both are easy to break by accident:
 *   - clearance requires EVERY required document, never a subset;
 *   - clearance is against a specific VERSION, so revising the text re-opens
 *     the gate for everyone automatically.
 */

/** All required docs accepted at `version`. */
const accepted = (version = LEGAL_VERSION): AcceptedRecord[] =>
  REQUIRED_LEGAL_DOCS.map((doc_key) => ({ doc_key, doc_version: version }));

describe("missingLegalDocs — clearance needs every document", () => {
  it("reports nothing missing when all are accepted at the current version", () => {
    expect(missingLegalDocs(accepted())).toEqual([]);
    expect(isLegalCleared(accepted())).toBe(true);
  });

  it("reports every document missing when nothing is accepted", () => {
    expect(missingLegalDocs([])).toEqual([...REQUIRED_LEGAL_DOCS]);
    expect(isLegalCleared([])).toBe(false);
  });

  it("does not grant clearance on a subset", () => {
    // The failure mode this guards: treating "they ticked one box" as consent.
    const partial = [{ doc_key: "privacy", doc_version: LEGAL_VERSION }];
    expect(isLegalCleared(partial)).toBe(false);
    expect(missingLegalDocs(partial)).toEqual(["terms", "guidelines"]);
  });

  it("ignores duplicates", () => {
    const dupes = [...accepted(), ...accepted()];
    expect(isLegalCleared(dupes)).toBe(true);
  });

  it("ignores unknown document keys", () => {
    const bogus = [
      ...accepted(),
      { doc_key: "marketing_opt_in", doc_version: LEGAL_VERSION },
    ];
    expect(isLegalCleared(bogus)).toBe(true);
  });
});

describe("missingLegalDocs — bumping the version re-opens the gate", () => {
  it("treats an acceptance of an older version as not current", () => {
    const old = accepted("2026-01-01");
    expect(isLegalCleared(old)).toBe(false);
    expect(missingLegalDocs(old)).toEqual([...REQUIRED_LEGAL_DOCS]);
  });

  it("does not accept a newer version than the one being asked for", () => {
    // A record from the future must not satisfy a check against today, or a
    // stale deployment could clear users against text that is not live.
    const future = accepted("2099-01-01");
    expect(isLegalCleared(future)).toBe(false);
  });

  it("clears once every old acceptance is replaced by the new version", () => {
    const mixed = [
      { doc_key: "terms", doc_version: "2026-01-01" },
      { doc_key: "privacy", doc_version: LEGAL_VERSION },
      { doc_key: "guidelines", doc_version: LEGAL_VERSION },
    ];
    expect(isLegalCleared(mixed)).toBe(false);
    expect(missingLegalDocs(mixed)).toEqual(["terms"]);

    mixed[0] = { doc_key: "terms", doc_version: LEGAL_VERSION };
    expect(isLegalCleared(mixed)).toBe(true);
  });
});

describe("document set", () => {
  it("requires exactly the three documents the gate names", () => {
    expect(REQUIRED_LEGAL_DOCS).toEqual(["terms", "privacy", "guidelines"]);
    expect(LEGAL_DOCUMENTS.map((d) => d.key)).toEqual([...REQUIRED_LEGAL_DOCS]);
  });

  it("ships every document at one version", () => {
    for (const d of LEGAL_DOCUMENTS) {
      expect(d.version).toBe(LEGAL_VERSION);
    }
  });

  it("is bilingual — every heading, body, title and summary has both languages", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      for (const lang of LEGAL_LANGS) {
        expect(doc.title[lang].trim().length, `${doc.key}.title.${lang}`).toBeGreaterThan(0);
        expect(doc.summary[lang].trim().length, `${doc.key}.summary.${lang}`).toBeGreaterThan(0);
      }
      for (const s of doc.sections) {
        for (const lang of LEGAL_LANGS) {
          expect(s.heading[lang].trim().length, `${doc.key} heading ${lang}`).toBeGreaterThan(0);
          expect(s.body[lang].trim().length, `${doc.key} body ${lang}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("gives both languages the same section structure", () => {
    // A section present in one language and missing in the other means a
    // customer reads a shorter contract depending on their language choice.
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.sections.length).toBeGreaterThan(0);
      const headings = new Set(doc.sections.map((s) => s.heading.en));
      expect(headings.size).toBe(doc.sections.length); // no duplicated headings
      for (const s of doc.sections) {
        expect(s.heading.ar.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("renders a flattened document per language", () => {
    const terms = getLegalDocument("terms");
    expect(terms).toBeDefined();
    const en = renderLegalDocument(terms!, "en");
    const ar = renderLegalDocument(terms!, "ar");
    expect(en).toContain("Terms of Service");
    expect(ar).toContain("شروط الخدمة");
    expect(en).toContain(`v${LEGAL_VERSION}`);
    // Arabic renders right-to-left and must not be empty or identical to English.
    expect(ar).not.toBe(en);
    expect(ar.length).toBeGreaterThan(200);
  });

  it("summarises without shipping the bodies", () => {
    const sums = legalDocSummaries("ar");
    expect(sums).toHaveLength(LEGAL_DOCUMENTS.length);
    for (const s of sums) {
      expect(s.title).toMatch(/[؀-ۿ]/);
      expect(s.section_count).toBeGreaterThan(0);
    }
  });
});

describe("language and age", () => {
  it("accepts only the shipped languages", () => {
    expect(isLegalLang("en")).toBe(true);
    expect(isLegalLang("ar")).toBe(true);
    expect(isLegalLang("fr")).toBe(false);
    expect(isLegalLang(null)).toBe(false);
    expect(isLegalLang(7)).toBe(false);
  });

  it("gates on 18+", () => {
    expect(MINIMUM_AGE).toBe(18);
  });
});