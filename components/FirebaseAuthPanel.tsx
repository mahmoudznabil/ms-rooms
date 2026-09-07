"use client";

import { useEffect, useState } from "react";
import {
  auth,
  googleProvider,
  getRecaptcha,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithPopup,
} from "@/lib/firebase";
import { syncFirebaseUser } from "@/lib/firebase-sync";
import { useSession } from "@/stores/useSession";

export default function FirebaseAuthPanel() {
  const [mode, setMode] = useState<"google" | "email" | "phone" | "link">("google");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phoneConfirm, setPhoneConfirm] = useState<import("firebase/auth").ConfirmationResult | null>(null);

  // Handle email-link redirect back
  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let storedEmail = window.localStorage.getItem("emailForSignIn") ?? "";
      if (!storedEmail) storedEmail = window.prompt("Confirm your email for sign-in") ?? "";
      if (storedEmail) {
        setBusy(true);
        signInWithEmailLink(auth, storedEmail, window.location.href)
          .then(async (cred) => {
            const { user, token } = await syncFirebaseUser(cred.user);
            useSession.setState({ user, token, ready: true, authError: null });
            try { window.localStorage.removeItem("emailForSignIn"); } catch {}
            window.history.replaceState({}, "", window.location.pathname);
            setMsg("Signed in with email link — progress restored across devices.");
          })
          .catch((e: Error) => setErr(e.message))
          .finally(() => setBusy(false));
      }
    }
  }, []);

  const afterFirebase = async (fbUser: import("firebase/auth").User) => {
    const { user, token } = await syncFirebaseUser(fbUser);
    // Persist like legacy login does
    try {
      window.localStorage.setItem("viberoom_token", token);
      window.localStorage.setItem("viberoom_uid", user.id);
    } catch {}
    useSession.setState({ user, token, ready: true, authError: null });
  };

  const handleGoogle = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await afterFirebase(cred.user);
      setMsg("Google sign-in complete — your coins, XP and rooms follow you on any device.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const handleEmail = async (create: boolean) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const cred = create
        ? await createUserWithEmailAndPassword(auth, email.trim(), password)
        : await signInWithEmailAndPassword(auth, email.trim(), password);
      await afterFirebase(cred.user);
      setMsg(create ? "Account created — progress will sync on every device." : "Signed in — progress restored.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const handleSendLink = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await sendSignInLinkToEmail(auth, email.trim(), {
        url: window.location.href,
        handleCodeInApp: true,
      });
      window.localStorage.setItem("emailForSignIn", email.trim());
      setMsg("Email link sent — check your inbox (and spam) to sign in on any device.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const handleSendCode = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const verifier = getRecaptcha("recaptcha-container");
      const conf = await signInWithPhoneNumber(auth, phone.trim(), verifier);
      setPhoneConfirm(conf);
      setMsg("SMS code sent — enter it below. Works on any device with your phone.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const handleVerifyCode = async () => {
    if (!phoneConfirm) return;
    setBusy(true); setErr(null);
    try {
      const cred = await phoneConfirm.confirm(code.trim());
      await afterFirebase(cred.user);
      setMsg("Phone verified — progress synced.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[#15151d] p-5">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {(["google", "email", "phone", "link"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold ${mode === m ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
            {m === "google" ? "Google" : m === "email" ? "Email + Password" : m === "phone" ? "Phone" : "Email Link"}
          </button>
        ))}
      </div>

      {mode === "google" && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-white/50">One tap — same Firebase identity on web & Android (mzn.muse.bestaudioroom). Progress stored in D1 by firebase_uid.</p>
          <button onClick={handleGoogle} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-50">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4285F4] text-xs font-black text-white">G</span>
            {busy ? "Connecting…" : "Continue with Google"}
          </button>
        </div>
      )}

      {mode === "email" && (
        <div className="mt-3 space-y-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ chars)" type="password"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => handleEmail(false)} disabled={busy || !email || !password}
              className="rounded-2xl bg-white py-2.5 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-40">Sign in</button>
            <button onClick={() => handleEmail(true)} disabled={busy || !email || password.length < 6}
              className="rounded-2xl bg-white/10 py-2.5 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-40">Create account</button>
          </div>
        </div>
      )}

      {mode === "link" && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-white/50">Passwordless — we send a link. Open it on any device to restore the same D1 progress.</p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none" />
          <button onClick={handleSendLink} disabled={busy || !email}
            className="w-full rounded-2xl bg-white py-2.5 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-40">
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
        </div>
      )}

      {mode === "phone" && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-white/50">Phone auth uses invisible reCAPTCHA. Your phone becomes the cross-device key.</p>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" type="tel"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none" />
          {!phoneConfirm ? (
            <button onClick={handleSendCode} disabled={busy || !phone}
              className="w-full rounded-2xl bg-white py-2.5 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-40">
              {busy ? "Sending…" : "Send SMS code"}
            </button>
          ) : (
            <div className="space-y-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none" />
              <button onClick={handleVerifyCode} disabled={busy || !code}
                className="w-full rounded-2xl bg-white py-2.5 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-40">
                Verify & sign in
              </button>
            </div>
          )}
          <div id="recaptcha-container" />
        </div>
      )}

      {msg && <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200">{msg}</p>}
      {err && <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{err}</p>}
      <p className="mt-3 text-center text-[11px] leading-relaxed text-white/35">
        Security: Firebase verifies the credential, the Worker verifies the ID token (aud=bestaudioroom) via Google tokeninfo, then D1 upserts by <code className="rounded bg-white/10 px-1">firebase_uid</code>. All coins/XP/rooms stay server-side.
      </p>
    </div>
  );
}
