"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
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
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";

// Web App config you provided — project: bestaudioroom
const firebaseConfig = {
  apiKey: "AIzaSyBphyNfZM-ijL31Y3xyJUlqbIclDazbfgg",
  authDomain: "bestaudioroom.firebaseapp.com",
  projectId: "bestaudioroom",
  storageBucket: "bestaudioroom.firebasestorage.app",
  messagingSenderId: "628489866765",
  appId: "1:628489866765:web:a75db602122ef083700f44",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Request profile so D1 can seed display_name/avatar
googleProvider.addScope("profile");
googleProvider.addScope("email");

// Helper to init invisible reCAPTCHA for phone auth once per page
let recaptcha: RecaptchaVerifier | null = null;
export function getRecaptcha(containerId = "recaptcha-container"): RecaptchaVerifier {
  if (recaptcha) return recaptcha;
  recaptcha = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
    theme: "dark",
  });
  return recaptcha;
}

export {
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithEmailLink,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
};
export type { User };

// Email link helpers: must use same origin URL
export const EMAIL_LINK_SETTINGS = {
  url: typeof window !== "undefined" ? `${window.location.origin}/login` : "https://bestaudioroom.firebaseapp.com/login",
  handleCodeInApp: true,
};
