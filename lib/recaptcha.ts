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

export function loadRecaptchaScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.grecaptcha) { scriptLoaded = true; return resolve(); }
    const s = document.createElement("script");
    s.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => { scriptLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("Failed to load reCAPTCHA"));
    document.head.appendChild(s);
  });
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
