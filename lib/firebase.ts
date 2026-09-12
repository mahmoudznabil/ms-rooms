"use client";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithEmailLink,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
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
export const auth: Auth = typeof window !== "undefined" ? getAuth(app) : ({} as Auth);

// Persist session across tabs/restarts (fixes refresh/new-tab session loss)
if (typeof window !== "undefined") {
  setPersistence(auth, browserLocalPersistence).catch(() => undefined);
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

export {
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithEmailLink,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
};
export type { User };

// Email link helpers: must use same origin URL
export const EMAIL_LINK_SETTINGS = {
  url: typeof window !== "undefined" ? `${window.location.origin}/login` : "https://bestaudioroom.firebaseapp.com/login",
  handleCodeInApp: true,
};
