"use client";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from "firebase/app-check";
import {
  getAuth as _getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber as _signInWithPhoneNumber,
  signInWithEmailAndPassword as _signInWithEmailAndPassword,
  createUserWithEmailAndPassword as _createUserWithEmailAndPassword,
  sendPasswordResetEmail as _sendPasswordResetEmail,
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

// Web App config — project: ms-rooms-auth (59506321553)
// Values come from NEXT_PUBLIC_* when present, otherwise the known web config.
// (An earlier revision hardcoded these and ignored the env — if you point the
// build at a different Firebase project and login breaks, this was why.)
const firebaseConfig = {
  apiKey: env("NEXT_PUBLIC_FIREBASE_API_KEY", "AIzaSyBgPuvvc8zt7y9dhB0_ZfeptaRAdRjZkmk"),
  authDomain: env("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "ms-rooms-auth.firebaseapp.com"),
  projectId: env("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "ms-rooms-auth"),
  storageBucket: env("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "ms-rooms-auth.firebasestorage.app"),
  messagingSenderId: env("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "59506321553"),
  appId: env("NEXT_PUBLIC_FIREBASE_APP_ID", "1:59506321553:web:d5db8040d4ce22667ef730")
};

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseApp = app;

// Firebase Authentication is protected by App Check in production. The
// visible checkbox used during registration is reCAPTCHA v2 and cannot be
// used as an App Check provider. App Check requires its own score-based v3
// site key, which is kept separate here. This key is public; the matching
// secret is never used in the browser.
const APP_CHECK_V3_KEY = env(
  "NEXT_PUBLIC_FIREBASE_APPCHECK_RECAPTCHA_V3_KEY",
  "6LdgXbQtAAAAAJAMc3Q68CFZG8_3gKeB6hErtWlq",
);
let appCheckInitError: unknown = null;
let appCheckInstance: AppCheck | null = null;

function initAppCheck(): AppCheck | null {
  if (typeof window === "undefined") return null;
  if (appCheckInstance) return appCheckInstance;
  try {
    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_V3_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    return appCheckInstance;
  } catch (e) {
    appCheckInitError = e;
    try {
      console.error("[firebase] App Check init failed:", e);
    } catch {}
    return null;
  }
}

/**
 * App Check is created on first use rather than at module load.
 *
 * ReCaptchaV3Provider injects Google's reCAPTCHA script, which is ~347 KB and
 * dominated the guest landing page's main thread (1.5s of the 2.4s total
 * blocking time) even though a logged-out visitor never authenticates. The
 * provider attaches to the app container, so it must be initialised before the
 * first auth request — but nothing else, so we hold it until sign-in is
 * actually attempted. `ensureAppCheck()` is called from the auth entry points.
 */
export function ensureAppCheck(): AppCheck | null {
  return initAppCheck();
}

export function getAppCheckInitError(): unknown {
  return appCheckInitError;
}

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
    // App Check first: Auth reads the provider from the Firebase app container
    // when it is created, so a token must exist before getAuth() runs. This is
    // still lazy relative to page load — it happens when auth is first touched,
    // not on every visitor's first paint.
    initAppCheck();
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
export function sendPasswordResetEmail(...args: Parameters<typeof _sendPasswordResetEmail>) {
  throwIfAuthBroken();
  return _sendPasswordResetEmail(...args);
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
  url: typeof window !== "undefined" ? `${window.location.origin}/login` : "https://ms-rooms-auth.firebaseapp.com/login",
  handleCodeInApp: true,
};
