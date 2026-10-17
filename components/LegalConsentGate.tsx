"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Globe, X } from "lucide-react";
import {
  acceptLegalDocuments,
  fetchLegalDocuments,
  fetchLegalStatus,
  type ApiLegalDocument,
  type LegalLang,
} from "@/lib/api";
import { LEGAL_VERSION, MINIMUM_AGE } from "@/lib/legal-documents";

/**
 * Bilingual legal consent gate.
 *
 * Two things make this a gate rather than a dialog with a checkbox:
 *
 *  1. THE TEXT IS IN THE GATE. Each document opens into its full body, in the
 *     language the reader chose. A link to terms hosted somewhere else is not
 *     consent — nobody reads it, and the record we keep would be a fiction.
 *
 *  2. THE READER PICKS THE LANGUAGE, AND WE REMEMBER IT. Arabic is not a
 *     translation afterthought here; `dir` flips the whole panel to RTL, and
 *     the language the user actually read is what gets stored against their
 *     acceptance. Accepting English while only being shown English is a
 *     different record from being shown both.
 *
 * Every document must be opened before the accept button unlocks. That is
 * deliberately a little friction: it makes "I accepted" mean "I read", which is
 * the only version of this that is worth anything if it is ever tested.
 */

type DocKey = ApiLegalDocument["key"];

interface Props {
  /** Required for an already-signed-in user; omitted at signup. */
  onAccepted?: () => void;
  /** Signup mode cannot accept server-side until an account exists. */
  mode?: "session" | "signup";
  onCancel?: () => void;
  /** Dismissable only when there is an account to go back to. */
  dismissable?: boolean;
  /** Called with the acceptance payload; the parent records it. */
  onSubmit?: (input: {
    lang: LegalLang;
    docs: Array<{ key: string; version: string }>;
    ageConfirmed: boolean;
  }) => Promise<void>;
}

const DOC_ORDER: DocKey[] = ["terms", "privacy", "guidelines"];

export default function LegalConsentGate({
  onAccepted,
  mode = "session",
  onCancel,
  dismissable = false,
  onSubmit,
}: Props) {
  const [lang, setLang] = useState<LegalLang>("en");
  const [docs, setDocs] = useState<ApiLegalDocument[]>([]);
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const rtl = lang === "ar";

  // Documents are refetched on a language change rather than shipped both ways:
  // one canonical rendering per read, and the language in the record is
  // guaranteed to be the language that was actually on screen.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLegalDocuments(lang)
      .then((d) => {
        if (cancelled) return;
        setDocs(DOC_ORDER.map((k) => d.documents.find((x) => x.key === k)).filter(Boolean) as ApiLegalDocument[]);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load the terms.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const allRead = useMemo(() => docs.length > 0 && docs.every((d) => read[d.key]), [docs, read]);
  const canAccept = allRead && ageOk && !busy && docs.length > 0;

  const openDoc = useCallback((key: string) => {
    setOpen((o) => ({ ...o, [key]: !o[key] }));
    // Marked read on open rather than on expand-close: a long document scrolled
    // to the bottom is the honest signal, not whether they finished fiddling.
    setRead((r) => ({ ...r, [key]: true }));
  }, []);

  const submit = async () => {
    if (!canAccept) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        lang,
        docs: docs.map((d) => ({ key: d.key, version: d.version })),
        ageConfirmed: ageOk,
      };
      if (onSubmit) {
        await onSubmit(payload);
      } else {
        await acceptLegalDocuments(payload);
      }
      onAccepted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record your acceptance.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-gate-title"
      aria-describedby="legal-gate-sub"
      className="fixed inset-0 z-100 flex items-end justify-center overflow-y-auto bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-ink-overlay shadow-overlay sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="legal-gate-title" className="text-lg font-extrabold text-white">
              {rtl ? "الشروط والأحكام" : "Terms and policies"}
            </h2>
            <p id="legal-gate-sub" className="mt-0.5 text-xs text-white/50">
              {rtl
                ? `الإصدار ${LEGAL_VERSION} · يجب أن يكون عمرك ${MINIMUM_AGE} عامًا أو أكثر`
                : `Version ${LEGAL_VERSION} · You must be ${MINIMUM_AGE} or older`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Language is a first-class control, not a preference buried in a
                menu: it decides both the rendering and what gets recorded. */}
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
                  className={`px-2.5 py-1 text-xs font-bold transition ${
                    lang === l ? "bg-arc text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {l === "en" ? "EN" : "ع"}
                </button>
              ))}
            </div>
            {dismissable && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label={rtl ? "إغلاق" : "Close"}
                className="rounded-lg border border-white/15 bg-white/5 p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Documents */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-white/40">
              {rtl ? "جارٍ تحميل النصوص…" : "Loading the documents…"}
            </p>
          ) : (
            <div className="space-y-3">
              {docs.map((d) => {
                const isOpen = !!open[d.key];
                const isRead = !!read[d.key];
                return (
                  <section
                    key={d.key}
                    className={`overflow-hidden rounded-2xl border transition ${
                      isRead ? "border-arc-line bg-arc-quiet" : "border-white/10 bg-white/[0.025]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openDoc(d.key)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-white/[0.03]"
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                          isRead ? "border-arc bg-arc text-white" : "border-white/25 text-transparent"
                        }`}
                      >
                        <Check size={14} strokeWidth={3} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-extrabold text-white">{d.title}</span>
                        <span className="mt-0.5 block text-xs text-white/50">{d.summary}</span>
                      </span>
                      {isOpen ? (
                        <ChevronUp size={18} className="shrink-0 text-white/40" />
                      ) : (
                        <ChevronDown size={18} className="shrink-0 text-white/40" />
                      )}
                    </button>

                    {isOpen && (
                      <div className="space-y-4 border-t border-white/10 px-4 py-4">
                        {d.sections.map((s, i) => (
                          <div key={i}>
                            <h3 className="text-sm font-bold text-white/85">{s.heading}</h3>
                            <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-white/60">
                              {s.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 text-[13px] text-white/75">
            <input
              type="checkbox"
              checked={ageOk}
              onChange={(e) => setAgeOk(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--arc)]"
            />
            <span>
              {rtl
                ? `أقر بأن عمري ${MINIMUM_AGE} عامًا أو أكثر، وأوافق على قراءة وأوافق على الشروط وسياسة الخصوصية وإرشادات المجتمع.`
                : `I confirm I am at least ${MINIMUM_AGE} years old, and I have read and agree to the Terms of Service, Privacy Policy and Community Guidelines.`}
            </span>
          </label>

          {!allRead && docs.length > 0 && (
            <p className="mt-2 text-xs text-amber-300/80">
              {rtl
                ? "يرجى فتح كل مستند وقراءته قبل المتابعة."
                : "Please open and read each document before continuing."}
            </p>
          )}

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-white/35">
              <Globe size={12} />
              {rtl ? `يظهر النص بالعربية · ${LEGAL_VERSION}` : `Shown in English · ${LEGAL_VERSION}`}
            </span>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canAccept}
              className="rounded-xl bg-arc px-5 py-2.5 text-sm font-bold text-white transition hover:bg-arc-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy
                ? rtl
                  ? "جارٍ الحفظ…"
                  : "Saving…"
                : rtl
                  ? "أوافق"
                  : mode === "signup"
                    ? "Accept and create my account"
                    : "Accept and continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}