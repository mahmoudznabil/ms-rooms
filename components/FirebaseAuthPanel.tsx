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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPhone, setShowPhone] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [phoneConfirm, setPhoneConfirm] = useState<import("firebase/auth").ConfirmationResult | null>(null);

  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let storedEmail = window.localStorage.getItem("emailForSignIn") ?? "";
      if (!storedEmail) storedEmail = window.prompt("Confirm your email for sign-in") ?? "";
      if (storedEmail) {
        setBusy(true);
        signInWithEmailLink(auth, storedEmail, window.location.href)
          .then(async (cred) => {
            const { user } = await syncFirebaseUser(cred.user);
            useSession.setState({ user, ready: true, authError: null });
            try { window.localStorage.removeItem("emailForSignIn"); } catch {}
            window.history.replaceState({}, "", window.location.pathname);
            setMsg("Signed in — progress restored across devices.");
          })
          .catch((e: Error) => setErr(e.message))
          .finally(() => setBusy(false));
      }
    }
  }, []);

  const afterFirebase = async (fbUser: import("firebase/auth").User) => {
    const { user } = await syncFirebaseUser(fbUser);
    useSession.setState({ user, ready: true, authError: null });
  };

  const handleGoogle = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await afterFirebase(cred.user);
      setMsg("Signed in — your coins, XP and Gems follow you.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const handleEmail = async (create: boolean) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const cred = create
        ? await createUserWithEmailAndPassword(auth, email.trim(), password)
        : await signInWithEmailAndPassword(auth, email.trim(), password);
      await afterFirebase(cred.user);
      setMsg(create ? "Account created." : "Signed in.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const handleSendLink = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await sendSignInLinkToEmail(auth, email.trim(), { url: `${window.location.origin}/login`, handleCodeInApp: true });
      window.localStorage.setItem("emailForSignIn", email.trim());
      setMsg("Link sent — check your inbox.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const handleSendCode = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const verifier = getRecaptcha("recaptcha-container");
      const conf = await signInWithPhoneNumber(auth, phone.trim(), verifier);
      setPhoneConfirm(conf);
      setMsg("Code sent — enter it below.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const handleVerifyCode = async () => {
    if (!phoneConfirm) return;
    setBusy(true); setErr(null);
    try {
      const cred = await phoneConfirm.confirm(code.trim());
      await afterFirebase(cred.user);
      setMsg("Phone verified.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111113] p-6 shadow-2xl">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">Sign in to MS-ROOMS</h2>
        <p className="mt-1 text-xs text-white/40">Your progress follows you on every device.</p>
      </div>

      <button onClick={handleGoogle} disabled={busy}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4285F4] text-xs font-bold text-white">G</span>
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs text-white/25">or continue with email</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <div className="space-y-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address"
          type="email"
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-white placeholder:text-white/25 focus:border-white/15 focus:outline-none focus:ring-1 focus:ring-white/10" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
          type="password"
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-white placeholder:text-white/25 focus:border-white/15 focus:outline-none focus:ring-1 focus:ring-white/10" />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => handleEmail(false)} disabled={busy || !email || !password}
            className="rounded-xl bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-30">Sign in</button>
          <button onClick={() => handleEmail(true)} disabled={busy || !email || password.length < 6}
            className="rounded-xl bg-white py-3 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-30">Create account</button>
        </div>
      </div>

      <div className="mt-4 flex justify-center gap-4 text-xs">
        <button onClick={() => setShowPhone((v) => !v)} className="text-white/40 hover:text-white/70 hover:underline">Phone</button>
        <span className="text-white/10">•</span>
        <button onClick={() => setShowLink((v) => !v)} className="text-white/40 hover:text-white/70 hover:underline">Email link</button>
      </div>

      {showPhone && (
        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <p className="text-xs text-white/40">Phone sign-in — same identity on web & Android.</p>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" type="tel"
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none" />
          {!phoneConfirm ? (
            <button onClick={handleSendCode} disabled={busy || !phone}
              className="mt-2 w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-40">Send code</button>
          ) : (
            <div className="mt-2 space-y-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none" />
              <button onClick={handleVerifyCode} disabled={busy || !code}
                className="w-full rounded-xl bg-white py-2.5 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40">Verify</button>
            </div>
          )}
          <div id="recaptcha-container" />
        </div>
      )}

      {showLink && (
        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <p className="text-xs text-white/40">We’ll send a passwordless link — open it on any device.</p>
          <button onClick={handleSendLink} disabled={busy || !email}
            className="mt-2 w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-40">Send link</button>
        </div>
      )}

      {msg && <p className="mt-4 rounded-xl bg-emerald-500/10 px-3 py-2 text-center text-xs text-emerald-200">{msg}</p>}
      {err && <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-center text-xs text-red-300">{err}</p>}

      <p className="mt-5 text-center text-[10px] leading-relaxed text-white/20">
        Firebase verifies, Worker verifies <code className="rounded bg-white/10 px-1 py-0.5">aud=bestaudioroom</code> → D1. Coins/Gems/XP server-side.
      </p>
    </div>
  );
}
