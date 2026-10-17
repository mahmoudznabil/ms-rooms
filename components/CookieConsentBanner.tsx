"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cookie, X, Settings, AlertCircle } from "lucide-react";

const CONSENT_KEY = "msrooms_cookie_consent";
const CONSENT_VERSION = 1;

type ConsentState = "granted" | "denied" | "pending";

export default function CookieConsentBanner() {
  const [state, setState] = useState<ConsentState>("pending");
  const [showBanner, setShowBanner] = useState(false);
  /** Observed by ResizeObserver so the reserved space tracks the real height. */
  const measureRef = useRef<HTMLDivElement | null>(null);
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

  // Reserve the space the banner occupies.
//
// This is the fix for the banner covering page content. Every earlier attempt
// was positional — move the card, shrink it, make it full width — and each one
// just relocated the occlusion: the right-hand card covered the landing hero's
// room mockup, and the full-width strip covered the hero's "Create a free
// account" button instead. On a viewport shorter than the content, ANY
// bottom-anchored overlay covers something. There is no position that avoids it.
//
// So the banner stops overlaying. It publishes its own height as a CSS custom
// property and globals.css pads the body by exactly that much, which pushes the
// page content above it at every viewport height. ResizeObserver rather than a
// fixed number, because the banner changes height — it grows when the
// third-party-cookie warning appears, and stacks to two rows on mobile.
//
// This sits ABOVE the early return on purpose. A hook after a conditional
// return is a Rules-of-Hooks violation: on the render where the banner is
// hidden the hook would not run, and on the render where it appears it would,
// changing hook order between renders.
//
// Cleared on unmount so the padding does not outlive the banner.
useEffect(() => {
  const el = measureRef.current;
  const root = document.documentElement;
  if (!el) return;
  const publish = () => {
    const h = Math.ceil(el.getBoundingClientRect().height);
    // +8px clears the banner's own bottom offset (1rem / md:bottom-4).
    root.style.setProperty("--consent-banner-h", `${h + 8}px`);
  };
  publish();
  const ro = new ResizeObserver(publish);
  ro.observe(el);
  return () => {
    ro.disconnect();
    root.style.setProperty("--consent-banner-h", "0px");
  };
}, []);

if (!showBanner || state === "granted" || state === "denied") return null;

  return (
    <div
      ref={measureRef}
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 animate-slide-up md:bottom-4 md:left-6 md:right-6"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="rounded-2xl border border-white/10 bg-ink-raised shadow-raised border-line-strong/95 backdrop-blur-sm px-4 py-3 shadow-2xl">
        {/* Three siblings: icon, copy, actions.

            The actions used to be NESTED INSIDE the copy column, which kept the
            banner three rows tall (measured 145px on the deployed site). On a
            full-width strip there is horizontal room for them beside the copy,
            and halving the height is what stops the notice covering the landing
            hero's content on a short viewport.

            flex-wrap handles the narrow case: the copy column is basis-full
            below md so it takes its own line and the actions drop underneath,
            which is the correct stacked order on mobile. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-xl bg-violet-500/20 text-violet-300">
            <Cookie size={20} />
          </div>

          <div className="min-w-0 flex-1 basis-full md:basis-auto">
            {/* Title and body on one line from md up. They were stacked, which
                put the strip at three rows and pushed its top edge over the
                landing hero's content on short viewports. */}
            <h3 className="text-sm font-bold text-white md:inline mr-2">Cookies &amp; Sign-In</h3>
            <p className="text-xs text-white/60 leading-relaxed md:inline">
              This site uses cookies for authentication. Google sign-in requires{" "}
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
          </div>

          <div className="flex shrink-0 items-center gap-2">
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