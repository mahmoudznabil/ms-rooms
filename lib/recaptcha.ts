"use client";

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "6LdgXbQtAAAAAJAMc3Q68CFZG8_3gKeB6hErtWlq";
const EXPO_SITE_KEY = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY || SITE_KEY;

declare global {
  interface Window {
    grecaptcha?: {
      render: (container: string | HTMLElement, params: { sitekey: string; callback?: (t: string) => void; "expired-callback"?: () => void }) => number;
      execute: (id?: number) => void;
      reset: (id?: number) => void;
      getResponse: (id?: number) => string;
    };
    onRecaptchaLoad?: () => void;
  }
}

let scriptLoaded = false;
let scriptLoading: Promise<void> | null = null;

export function getSiteKey(): string {
  // Works for Next.js (NEXT_PUBLIC_) and Expo (EXPO_PUBLIC_)
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_RECAPTCHA_SITE_KEY) return process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (typeof process !== "undefined" && (process.env as Record<string, string | undefined>)?.EXPO_PUBLIC_RECAPTCHA_SITE_KEY) return (process.env as Record<string, string | undefined>).EXPO_PUBLIC_RECAPTCHA_SITE_KEY!;
  return SITE_KEY || EXPO_SITE_KEY;
}

/** True only for the REAL library — blockers inject a neutered `grecaptcha`
 *  stub without `render`, which must not count as loaded. */
export function isRecaptchaReady(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return typeof (window.grecaptcha as unknown as { render?: unknown } | undefined)?.render === "function";
  } catch {
    return false;
  }
}

export function loadRecaptchaScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (isRecaptchaReady()) {
    scriptLoaded = true;
    scriptLoading = null;
    return Promise.resolve();
  }
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<void>((resolve, reject) => {
    const fail = (msg: string) => reject(new Error(msg));
    const check = () => {
      if (isRecaptchaReady()) {
        scriptLoaded = true;
        resolve();
      } else {
        fail(
          "Security check was blocked (grecaptcha.render is not a function) — an ad-blocker, Brave Shields, or private DNS may be neutering google.com/recaptcha. Allow it for this site, then reopen this page."
        );
      }
    };
    // A blocker stub may already sit on window.grecaptcha: loading the real
    // script overwrites it. If our script is blocked too, fail loudly.
    try {
      const s = document.createElement("script");
      s.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      let settled = false;
      s.onload = () => {
        if (settled) return;
        settled = true;
        // Give the library a beat to define render before judging.
        setTimeout(check, 400);
      };
      s.onerror = () => {
        if (settled) return;
        settled = true;
        fail("Security check couldn't load — an ad-blocker may be blocking google.com. Disable it for this site, then reopen this page.");
      };
      document.head.appendChild(s);
      // Blockers sometimes swallow both load and error events: time out.
      setTimeout(() => {
        if (settled || scriptLoaded) return;
        settled = true;
        check();
      }, 9000);
    } catch {
      fail("Security check couldn't load — reload the page and try again.");
    }
  });
  // Never cache a rejection: the user may allow the blocker and retry.
  scriptLoading.then(
    () => {},
    () => {
      if (!isRecaptchaReady()) scriptLoading = null;
    }
  );
  return scriptLoading;
}

export async function verifyRecaptchaToken(token: string): Promise<boolean> {
  // Client delegates verification to Worker so secret never leaks.
  // Bounded with a timeout: a stalled network must never freeze the UI.
  const { API_BASE } = await import("@/lib/api");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/recaptcha/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new Error(e instanceof DOMException && e.name === "TimeoutError"
      ? "Verification timed out — check your connection and try again."
      : "Could not reach the verification server — check your connection and try again.");
  }
  const data = await res.json().catch(() => null) as { ok?: boolean } | null;
  return !!data?.ok;
}
