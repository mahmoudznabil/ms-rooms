"use client";

import { useCallback, useEffect, useState } from "react";
import { Cookie, X, Settings, AlertCircle } from "lucide-react";

const CONSENT_KEY = "msrooms_cookie_consent";
const CONSENT_VERSION = 1;

type ConsentState = "granted" | "denied" | "pending";

export default function CookieConsentBanner() {
  const [state, setState] = useState<ConsentState>("pending");
  const [showBanner, setShowBanner] = useState(false);
  const [thirdPartyBlocked, setThirdPartyBlocked] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.version === CONSENT_VERSION) {
          setState(parsed.consent);
        } else {
          localStorage.removeItem(CONSENT_KEY);
        }
      }
      setShowBanner(true);
    } catch {
      setShowBanner(true);
    }
  }, []);

  const checkThirdPartyCookies = useCallback(async () => {
    try {
      const testUrl = "https://bestaudioroom.firebaseapp.com/__/auth/handler";
      await fetch(testUrl, {
        method: "HEAD",
        mode: "no-cors",
        credentials: "include",
      });
      setThirdPartyBlocked(false);
    } catch {
      setThirdPartyBlocked(true);
    }
  }, []);

  useEffect(() => {
    if (state === "granted") {
      void checkThirdPartyCookies();
    }
  }, [state, checkThirdPartyCookies]);

  const persistConsent = (consent: "granted" | "denied") => {
    // Private-mode storage throws on write — keep the choice in memory so the
    // banner still dismisses instead of crashing the click handler.
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION, consent }));
    } catch {}
  };

  const accept = () => {
    persistConsent("granted");
    setState("granted");
    checkThirdPartyCookies();
  };

  const decline = () => {
    persistConsent("denied");
    setState("denied");
  };

  const openCookieSettings = () => {
    // chrome:// URLs only work in Chrome. Everyone else gets their vendor's
    // cookie help page; Brave users additionally need Shields down for Google.
    const ua = navigator.userAgent;
    let help = "https://support.google.com/chrome/answer/95647";
    if (/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) {
      help = "https://support.apple.com/guide/safari/manage-cookies-sfri11471/mac";
    } else if (/firefox|fxios/i.test(ua)) {
      help = "https://support.mozilla.org/kb/cookies-information-websites-store-on-your-computer";
    } else if (/edg/i.test(ua)) {
      help = "https://support.microsoft.com/microsoft-edge/delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09";
    }
    try {
      window.open(help, "_blank", "noopener");
    } catch {}
  };

  if (!showBanner || state === "granted" || state === "denied") return null;

  return (
    <div
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 md:bottom-6 md:left-auto md:right-6 md:w-96 z-50 animate-slide-up"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="rounded-2xl border border-white/10 bg-ink-raised shadow-raised border-line-strong/95 backdrop-blur-sm p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-xl bg-violet-500/20 text-violet-300">
            <Cookie size={20} />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-white">Cookies & Sign-In</h3>
            <p className="mt-1 text-xs text-white/60 leading-relaxed">
              This site uses cookies for authentication. Google sign-in requires
              <strong className="text-white">third-party cookies</strong> to complete the redirect flow.
            </p>

            {thirdPartyBlocked && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
                <AlertCircle size={14} className="text-amber-300 shrink-0" />
                <div className="text-xs text-amber-200">
                  Third-party cookies appear blocked. Google sign-in will fail until enabled.
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={accept}
                className="rounded-lg bg-white px-4 py-1.5 min-h-[44px] text-xs font-semibold text-black transition hover:bg-white/85"
              >
                Accept All
              </button>
              <button
                onClick={decline}
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-1.5 min-h-[44px] text-xs font-semibold text-white transition hover:bg-white/10"
              >
                Decline
              </button>
              {thirdPartyBlocked && (
                <button
                  onClick={openCookieSettings}
                  className="flex items-center gap-1 rounded-lg border border-violet-400/30 bg-violet-500/10 px-4 py-1.5 min-h-[44px] text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20"
                >
                  <Settings size={12} />
                  Open Cookie Settings
                </button>
              )}
            </div>
          </div>

          <button
            onClick={() => setShowBanner(false)}
            className="flex-shrink-0 rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-2 text-center text-[10px] text-white/30">
          You can change this anytime in Settings.
        </p>
      </div>
    </div>
  );
}