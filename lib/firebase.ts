"use client";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth as _getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber as _signInWithPhoneNumber,
  signInWithEmailAndPassword as _signInWithEmailAndPassword,
  createUserWithEmailAndPassword as _createUserWithEmailAndPassword,
  signInWithEmailLink as _signInWithEmailLink,
  sendSignInLinkToEmail as _sendSignInLinkToEmail,
  isSignInWithEmailLink as _isSignInWithEmailLink,
  signInWithPopup as _signInWithPopup,
  signInWithRedirect as _signInWithRedirect,
  getRedirectResult as _getRedirectResult,
  signOut as _signOut,
  onAuthStateChanged as _onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  type User,
  type Auth,
} from "firebase/auth";

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

// Web App config — project: bestaudioroom (628489866765)
// Values come from NEXT_PUBLIC_* when present, otherwise the known web config.
const firebaseConfig = {
  apiKey: env("NEXT_PUBLIC_FIREBASE_API_KEY", "AIzaSyBphyNfZM-ijL31Y3xyJUlqbIclDazbfgg"),
  authDomain: env("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "bestaudioroom.firebaseapp.com"),
  projectId: env("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "bestaudioroom"),
  storageBucket: env("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "bestaudioroom.firebasestorage.app"),
  messagingSenderId: env("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "628489866765"),
  appId: env("NEXT_PUBLIC_FIREBASE_APP_ID", "1:628489866765:web:a75db602122ef083700f44"),
};

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseApp = app;
// getAuth() touches the Auth component registry, which is not registered in
// the Node bundle during Next.js static prerender (/_not-found etc.) —
// that crashed the export build. Auth is only ever used in the browser
// (click handlers / effects), so init it lazily on the client.
//
// Hardening: the repo currently has TWO copies of @firebase/component
// (nested 0.7.3 under @firebase/auth vs hoisted 0.7.5) and the webpack alias
// in next.config.ts does not apply under Turbopack — so getAuth() can throw
// "Component auth has not been registered yet" at module load. Because every
// page statically bundles this module (layout → AppShell → LoginView →
// FirebaseAuthPanel), that used to kill the whole app chunk during hydration
// and freeze the page on "Tuning the frequency…" forever. Never let init take
// the app down: fall back to a logged-out stub so boot() always reaches
// ready:true, and surface the real error only when sign-in is attempted.
let authInitError: unknown = null;

function brokenAuthStub(): Auth {
  const noop = () => undefined;
  return {
    currentUser: null,
    onAuthStateChanged: ((next: (u: null) => void) => {
      try {
        setTimeout(() => {
          try {
            next(null);
          } catch {}
        }, 0);
      } catch {}
      return noop;
    }) as unknown as Auth["onAuthStateChanged"],
  } as Auth;
}

function initAuth(): Auth {
  if (typeof window === "undefined") return {} as Auth;
  try {
    const a = _getAuth(app);
    // Persist session across tabs/restarts (fixes refresh/new-tab session loss)
    try {
      setPersistence(a, browserLocalPersistence).catch(() => undefined);
    } catch {}
    return a;
  } catch (e) {
    authInitError = e;
    try {
      console.error("[firebase] auth init failed, running logged-out:", e);
    } catch {}
    return brokenAuthStub();
  }
}

export const auth: Auth = initAuth();

/** Non-null when auth fell back to the logged-out stub (see above). */
export function getAuthInitError(): unknown {
  return authInitError;
}

function throwIfAuthBroken(): void {
  if (authInitError) throw authInitError;
}

export const googleProvider = new GoogleAuthProvider();
// Request profile so D1 can seed display_name/avatar
googleProvider.addScope("profile");
googleProvider.addScope("email");
googleProvider.setCustomParameters({ prompt: "select_account" });

// --- Invisible reCAPTCHA for phone auth (re-creatable for StrictMode/HMR) ---
let recaptcha: RecaptchaVerifier | null = null;
export function getRecaptcha(containerId = "recaptcha-container"): RecaptchaVerifier {
  if (recaptcha) return recaptcha;
  recaptcha = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
  });
  return recaptcha;
}
export function clearRecaptcha(): void {
  try {
    recaptcha?.clear();
  } catch {
    // ignore
  }
  recaptcha = null;
}

// --- Lazy Firebase Analytics (no-ops on server / when unsupported) ---
export async function getFirebaseAnalytics(): Promise<null | Awaited<ReturnType<typeof import("firebase/analytics").getAnalytics>>> {
  if (typeof window === "undefined") return null;
  try {
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    if (!(await isSupported())) return null;
    return getAnalytics(app);
  } catch {
    return null;
  }
}

// --- Lazy Firebase Performance Monitoring ---
export async function getFirebasePerformance(): Promise<null | Awaited<ReturnType<typeof import("firebase/performance").getPerformance>>> {
  if (typeof window === "undefined") return null;
  try {
    const { getPerformance } = await import("firebase/performance");
    return getPerformance(app);
  } catch {
    return null;
  }
}

// --- Latest Firebase AI Logic (client-side Gemini, Google AI backend) ---
// Docs: firebase/ai — getAI(app, { backend: new GoogleAIBackend() })
export async function getFirebaseAIModel(modelName = "gemini-2.5-flash") {
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import("firebase/ai");
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, { model: modelName });
}

// Wrapped re-exports: same names/signatures as firebase/auth, but if auth
// init failed (stub mode) they fail fast with the REAL init error instead of
// cryptic downstream crashes. Read-only probes degrade gracefully so boot()
// and the redirect-return effect always complete.
export function signInWithPhoneNumber(...args: Parameters<typeof _signInWithPhoneNumber>) {
  throwIfAuthBroken();
  return _signInWithPhoneNumber(...args);
}
export function signInWithEmailAndPassword(...args: Parameters<typeof _signInWithEmailAndPassword>) {
  throwIfAuthBroken();
  return _signInWithEmailAndPassword(...args);
}
export function createUserWithEmailAndPassword(...args: Parameters<typeof _createUserWithEmailAndPassword>) {
  throwIfAuthBroken();
  return _createUserWithEmailAndPassword(...args);
}
export function signInWithEmailLink(...args: Parameters<typeof _signInWithEmailLink>) {
  throwIfAuthBroken();
  return _signInWithEmailLink(...args);
}
export function sendSignInLinkToEmail(...args: Parameters<typeof _sendSignInLinkToEmail>) {
  throwIfAuthBroken();
  return _sendSignInLinkToEmail(...args);
}
export function isSignInWithEmailLink(...args: Parameters<typeof _isSignInWithEmailLink>) {
  if (authInitError) return false;
  return _isSignInWithEmailLink(...args);
}
export function signInWithPopup(...args: Parameters<typeof _signInWithPopup>) {
  throwIfAuthBroken();
  return _signInWithPopup(...args);
}
export function signInWithRedirect(...args: Parameters<typeof _signInWithRedirect>) {
  throwIfAuthBroken();
  return _signInWithRedirect(...args);
}
export async function getRedirectResult(...args: Parameters<typeof _getRedirectResult>) {
  if (authInitError) return null;
  return _getRedirectResult(...args);
}
export function signOut(...args: Parameters<typeof _signOut>) {
  if (authInitError) return Promise.resolve();
  return _signOut(...args);
}
export function onAuthStateChanged(...args: Parameters<typeof _onAuthStateChanged>) {
  if (authInitError) {
    const cb = args[1] as unknown as (u: null) => void;
    try {
      setTimeout(() => {
        try {
          cb(null);
        } catch {}
      }, 0);
    } catch {}
    return () => undefined;
  }
  return (_onAuthStateChanged as (...a: unknown[]) => unknown)(...args) as ReturnType<typeof _onAuthStateChanged>;
}
export { setPersistence, browserLocalPersistence };
export type { User };

// Email link helpers: must use same origin URL
export const EMAIL_LINK_SETTINGS = {
  url: typeof window !== "undefined" ? `${window.location.origin}/login` : "https://bestaudioroom.firebaseapp.com/login",
  handleCodeInApp: true,
};
