"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Globe } from "lucide-react";
import { fetchLegalDocuments, type ApiLegalDocument, type LegalLang } from "@/lib/api";
import { LEGAL_PENDING_OPERATOR_VALUES, LEGAL_VERSION, MINIMUM_AGE } from "@/lib/legal-documents";

/**
 * Public, bilingual reader for the legal documents.
 *
 * WHY THIS RENDERS FROM `lib/legal-documents.ts` INSTEAD OF BEING ITS OWN PAGE
 *
 * There used to be a hand-written `/privacy-policy` page. It was a second,
 * independent copy of the same commitments, and the two had drifted into
 * actively contradicting each other — the old page still told readers that coins
 * were "earned-only… there is no web checkout" after coin packs had shipped,
 * named two different contact addresses, and was English-only. It was also
 * linked from nowhere, which is its own problem: a privacy policy nobody can
 * reach is not a disclosure.
 *
 * Rendering from the module removes the class of bug entirely. There is now one
 * set of words, and it is the same set a customer's consent record points at.
 * If the text changes, every surface changes with it, and the version a customer
 * accepted still resolves to readable text years later.
 *
 * Deliberately no sign-in required. Egyptian consumer law expects consumer-facing
 * documents to be available before a transaction, and someone deciding whether
 * to register is exactly the reader who needs them.
 */

type DocKey = ApiLegalDocument["key"];

const ORDER: DocKey[] = ["terms", "privacy", "guidelines"];

export default function LegalReader({
  /** Show only this document; omit to show all three. */
  only,
}: {
  only?: DocKey;
}) {
  const [lang, setLang] = useState<LegalLang>("en");
  const [docs, setDocs] = useState<ApiLegalDocument[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const rtl = lang === "ar";

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchLegalDocuments(lang)
      .then((d) => {
        if (cancelled) return;
        const ordered = ORDER.map((k) => d.documents.find((x) => x.key === k)).filter(
          Boolean
        ) as ApiLegalDocument[];
        setDocs(ordered);
        // A single-document page opens its own document; the combined view
        // opens all of them, since that is the whole point of reading it.
        setOpen(only ? { [only]: true } : { terms: true, privacy: true, guidelines: true });
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load the documents.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [lang, only]);

  const shown = useMemo(() => (only ? docs.filter((d) => d.key === only) : docs), [docs, only]);

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="mx-auto w-full max-w-3xl px-5 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-black tracking-tight text-white">
            {rtl ? "الشروط والأحكام" : "Terms & policies"}
          </h1>
          <p className="mt-1 text-xs text-white/45">
            {rtl
              ? `الإصدار ${LEGAL_VERSION} · الحد الأدنى للعمر ${MINIMUM_AGE} عامًا`
              : `Version ${LEGAL_VERSION} · Minimum age ${MINIMUM_AGE}`}
          </p>
        </div>

        <div
          role="group"
          aria-label={rtl ? "لغة النصوص" : "Document language"}
          className="flex overflow-hidden rounded-lg border border-white/15"
        >
          {(["en", "ar"] as LegalLang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition ${
                lang === l ? "bg-arc text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              <Globe size={12} />
              {l === "en" ? "English" : "العربية"}
            </button>
          ))}
        </div>
      </div>

      {status === "loading" && (
        <p className="mt-8 text-sm text-white/40">
          {rtl ? "جارٍ تحميل النصوص…" : "Loading…"}
        </p>
      )}

      {status === "error" && (
        <p role="alert" className="mt-8 text-sm text-red-300">
          {error ?? (rtl ? "تعذّر تحميل النصوص." : "Could not load the documents.")}
        </p>
      )}

      {status === "ready" && (
        <div className="mt-6 space-y-4">
          {shown.map((d) => {
            const isOpen = !!open[d.key];
            return (
              <section
                key={d.key}
                id={d.key}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]"
              >
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [d.key]: !o[d.key] }))}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition hover:bg-white/[0.03]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-extrabold text-white">{d.title}</span>
                    <span className="mt-0.5 block text-xs text-white/50">{d.summary}</span>
                  </span>
                  {isOpen ? (
                    <ChevronUp size={18} className="shrink-0 text-white/40" />
                  ) : (
                    <ChevronDown size={18} className="shrink-0 text-white/40" />
                  )}
                </button>

                {isOpen && (
                  <div className="space-y-5 border-t border-white/10 px-4 py-4">
                    {d.sections.map((s, i) => (
                      <div key={i}>
                        <h2 className="text-sm font-bold text-white/85">{s.heading}</h2>
                        <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-white/65">
                          {s.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {LEGAL_PENDING_OPERATOR_VALUES.length > 0 && (
            <p className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-[11px] leading-relaxed text-white/45">
              {rtl
                ? "بعض بيانات التسجيل لدى المشغّل غير متاحة على هذه الصفحة، وتُقدَّم عند الطلب عبر البريد الإلكتروني المسجل أعلاه."
                : "Some operator registration details are not published on this page and are supplied on request via the email address above."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}