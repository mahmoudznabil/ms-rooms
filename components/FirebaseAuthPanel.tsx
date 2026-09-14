"use client";

import { useEffect, useState, useRef } from "react";
import {
  auth,
  googleProvider,
  getRecaptcha,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  sendPasswordResetEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "@/lib/firebase";
import { syncFirebaseUser } from "@/lib/firebase-sync";
import { useSession } from "@/stores/useSession";
import { getSiteKey, loadRecaptchaScript, verifyRecaptchaToken } from "@/lib/recaptcha";
import { logAuthEvent } from "@/lib/metrics";

// GitHub login principles, MS-ROOMS theme: one narrow column, a bordered
// action card with labeled fields, a secondary card that switches modes,
// quiet alternatives below. Email+password and phone (SMS code) are the
// primary methods; Google is a secondary button. (Firebase has no
// phone+password concept — phone numbers sign in via SMS code.)
type Mode = "signin" | "create" | "phone";

function formatAuthError(e: unknown): string {
  const err = e as { code?: string; message?: string; customData?: unknown };
  const code = err?.code ?? "";
  const msg = err?.message ?? String(e);
  // auth/internal-error wraps the REAL cause (e.g. API-key referrer block).
  // Surface it so the banner diagnoses itself.
  let detail = "";
  try {
    const cd = err?.customData as { message?: string } | undefined;
    if (cd?.message && cd.message !== msg) detail = cd.message;
    else if (cd && typeof cd === "object") detail = JSON.stringify(cd);
  } catch {}
  if (detail) detail = detail.slice(0, 250);
  const full = detail ? `${msg} | detail: ${detail}` : msg;
  try {
    console.error("[auth]", code, msg, (err?.customData ?? e) as unknown);
  } catch {}
  if (
    code === "auth/internal-error" ||
    msg.includes("internal-error") ||
    msg.includes("Database is closing")
  ) {
    return `${full} (code: ${code || "auth/internal-error"}). Usually: popup blocked, 3rd-party cookies/adblock, domain missing from Firebase Authorized Domains, or Firebase JS 12.17+ popup bug — redirect fallback runs automatically, or run: npm i firebase@12.16.0.`;
  }
  return code ? `${full} (code: ${code})` : full;
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-violet-400/60 focus:outline-none focus:ring-1 focus:ring-violet-400/30";
const labelCls = "mb-1.5 block text-sm font-semibold text-white/85";
const primaryBtn =
  "w-full rounded-lg bg-white py-2 text-sm font-semibold text-black transition hover:bg-white/85 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40";
const secondaryBtn =
  "flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-40";

export default function FirebaseAuthPanel() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phoneConfirm, setPhoneConfirm] = useState<import("firebase/auth").ConfirmationResult | null>(null);
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [recaptchaError, setRecaptchaError] = useState<string | null>(null);
  const recaptchaWidgetId = useRef<number | null>(null);
  const siteKey = getSiteKey();

  const switchMode = (m: Mode) => {
    setErr(null);
    setMsg(null);
    setPhoneConfirm(null);
    setMode(m);
  };

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
          .catch((e: unknown) => setErr(formatAuthError(e)))
          .finally(() => setBusy(false));
      }
    }
  }, []);

  // Registration reCAPTCHA widget (site key: 6LdgXbQt...). Rendered when the
  // create-account card mounts; the node remounts on mode switches, so a
  // stale widget id is dropped and rendered fresh.
  useEffect(() => {
    if (mode !== "create") return;
    let cancelled = false;
    setRecaptchaError(null);
    loadRecaptchaScript().then(() => {
      if (cancelled || !window.grecaptcha) return;
      const el = document.getElementById("register-recaptcha");
      if (!el) return;
      try {
        if (recaptchaWidgetId.current !== null) {
          try { window.grecaptcha.reset(recaptchaWidgetId.current); } catch {}
          recaptchaWidgetId.current = null;
        }
        el.innerHTML = "";
        recaptchaWidgetId.current = window.grecaptcha.render(el, {
          sitekey: siteKey,
          callback: (t: string) => setRecaptchaToken(t),
          "expired-callback": () => setRecaptchaToken(null),
        });
      } catch {
        if (!cancelled) setRecaptchaError("Security check couldn't start — reload the page and try again.");
      }
    }).catch(() => {
      // Script blocked (usually an ad-blocker on google.com) — the button
      // would otherwise stay disabled forever with no explanation.
      if (!cancelled) setRecaptchaError("Security check couldn't load — an ad-blocker may be blocking google.com. Disable it for this site, then reopen this page.");
    });
    return () => { cancelled = true; };
  }, [siteKey, mode]);

  const afterFirebase = async (fbUser: import("firebase/auth").User) => {
    const { user } = await syncFirebaseUser(fbUser);
    useSession.setState({ user, ready: true, authError: null });
  };

  // Completes signInWithRedirect fallback (popup blocked / internal-error path).
  // A sessionStorage flag marks that WE started a redirect, so a return with
  // no credential becomes a visible error instead of a silent login loop.
  useEffect(() => {
    let cancelled = false;
    let expectRedirect = false;
    try {
      expectRedirect = sessionStorage.getItem("msrooms_google_redirect") === "1";
    } catch {}
    if (expectRedirect) {
      setBusy(true);
      setMsg("Completing Google sign-in…");
    }
    getRedirectResult(auth)
      .then(async (res) => {
        try {
          sessionStorage.removeItem("msrooms_google_redirect");
        } catch {}
        if (cancelled) return;
        if (!res?.user) {
          if (expectRedirect) {
            let popupErr = "";
            try {
              popupErr = sessionStorage.getItem("msrooms_google_popup_error") ?? "";
              sessionStorage.removeItem("msrooms_google_popup_error");
            } catch {}
            setErr(
              `Google returned without a credential (code: auth/redirect-incomplete).` +
              (popupErr ? ` Popup had failed first with: ${popupErr}.` : "") +
              ` If that says auth/unauthorized-domain, add bestaudiobackend.mahmoudnabil03.workers.dev under Firebase Console → Authentication → Settings → Authorized domains. Otherwise allow third-party cookies for this site, or use email sign-in.`
            );
          }
          return;
        }
        setBusy(true);
        try {
          await afterFirebase(res.user);
          logAuthEvent("google", "success");
          setMsg("Signed in — your coins, XP and Gems follow you.");
        } catch (e: unknown) {
          logAuthEvent("google", "failure", e instanceof Error ? e.message : undefined);
          setErr(formatAuthError(e));
        } finally {
          if (!cancelled) setBusy(false);
        }
      })
      .catch((e: unknown) => {
        try {
          sessionStorage.removeItem("msrooms_google_redirect");
        } catch {}
        if (!cancelled) {
          setBusy(false);
          setErr(formatAuthError(e));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogle = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      // NOTE: signInWithPopup must be the first await — it has to run inside
      // the click gesture or Chrome blocks the popup (instant internal-error).
      // Persistence is already set at module load in lib/firebase.ts.
      const cred = await signInWithPopup(auth, googleProvider);
      await afterFirebase(cred.user);
      logAuthEvent("google", "success");
      setMsg("Signed in — your coins, XP and Gems follow you.");
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? "";
      const msg = e instanceof Error ? e.message : String(e);
      const popupBroken =
        code === "auth/internal-error" ||
        code === "auth/popup-blocked" ||
        code === "auth/popup-closed-by-user" ||
        code === "auth/network-request-failed" ||
        code === "auth/cancelled-popup-request" ||
        msg.includes("internal-error") ||
        msg.includes("Database is closing");
      if (popupBroken) {
        try {
          const popupCode = (code || msg).slice(0, 200);
          try {
            sessionStorage.setItem("msrooms_google_redirect", "1");
            sessionStorage.setItem("msrooms_google_popup_error", popupCode);
          } catch {}
          setMsg(`Popup failed (${popupCode}) — redirecting to Google…`);
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (e2: unknown) {
          logAuthEvent("google", "failure", e2 instanceof Error ? e2.message : undefined);
          setErr(formatAuthError(e2));
        }
      } else {
        logAuthEvent("google", "failure", e instanceof Error ? e.message : undefined);
        setErr(formatAuthError(e));
      }
    } finally { setBusy(false); }
  };

  const handleEmail = async (create: boolean) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      if (create) {
        const token = recaptchaToken || window.grecaptcha?.getResponse(recaptchaWidgetId.current ?? undefined) || "";
        if (!token) throw new Error("Please complete the reCAPTCHA to register.");
        const ok = await verifyRecaptchaToken(token);
        if (!ok) throw new Error("reCAPTCHA verification failed — try again.");
      }
      const cred = create
        ? await createUserWithEmailAndPassword(auth, email.trim(), password)
        : await signInWithEmailAndPassword(auth, email.trim(), password);
      await afterFirebase(cred.user);
      logAuthEvent("email", "success");
      setMsg(create ? "Account created." : "Signed in.");
      if (create && window.grecaptcha && recaptchaWidgetId.current !== null) {
        try { window.grecaptcha.reset(recaptchaWidgetId.current); } catch {}
        setRecaptchaToken(null);
      }
    } catch (e: unknown) { logAuthEvent("email", "failure", e instanceof Error ? e.message : undefined); setErr(formatAuthError(e)); } finally { setBusy(false); }
  };

  const handleForgot = async () => {
    if (!email.trim()) {
      setErr("Enter your email address above, then use Forgot password?.");
      return;
    }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg("Password reset link sent — check your inbox.");
    } catch (e: unknown) { setErr(formatAuthError(e)); } finally { setBusy(false); }
  };

  const handleSendLink = async () => {
    if (!email.trim()) {
      setErr("Enter your email address above first.");
      return;
    }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await sendSignInLinkToEmail(auth, email.trim(), { url: `${window.location.origin}/login`, handleCodeInApp: true });
      window.localStorage.setItem("emailForSignIn", email.trim());
      setMsg("Link sent — check your inbox.");
    } catch (e: unknown) { setErr(formatAuthError(e)); } finally { setBusy(false); }
  };

  const handleSendCode = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const verifier = getRecaptcha("recaptcha-container");
      const conf = await signInWithPhoneNumber(auth, phone.trim(), verifier);
      setPhoneConfirm(conf);
      setMsg("Code sent — enter it below.");
    } catch (e: unknown) { setErr(formatAuthError(e)); } finally { setBusy(false); }
  };

  const handleVerifyCode = async () => {
    if (!phoneConfirm) return;
    setBusy(true); setErr(null);
    try {
      const cred = await phoneConfirm.confirm(code.trim());
      await afterFirebase(cred.user);
      logAuthEvent("phone", "success");
      setMsg("Phone verified.");
    } catch (e: unknown) { setErr(formatAuthError(e)); } finally { setBusy(false); }
  };

  const canSubmitPassword = email.trim().length > 0 && (mode === "signin" ? password.length > 0 : password.length >= 6);
  const needRecaptcha = mode === "create" && !recaptchaToken;

  return (
    <div className="w-full">
      <h1 className="mt-4 text-center text-2xl font-light text-white">
        {mode === "create" ? "Create your account" : mode === "phone" ? "Sign in with phone" : "Sign in to MS-ROOMS"}
      </h1>

      {err && (
        <div role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}
      {msg && !err && (
        <div className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {msg}
        </div>
      )}

      {mode !== "phone" ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-[#15151d] p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleEmail(mode === "create");
            }}
          >
            <div>
              <label htmlFor="auth-email" className={labelCls}>Email address</label>
              <input
                id="auth-email" value={email} onChange={(e) => setEmail(e.target.value)}
                type="email" autoComplete="email" placeholder="you@example.com"
                className={inputCls} />
            </div>
            <div className="mt-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="auth-password" className="!mb-0 block text-sm font-semibold text-white/85">Password</label>
                {mode === "signin" && (
                  <button type="button" onClick={() => void handleForgot()} disabled={busy}
                    className="text-xs text-violet-300 hover:underline disabled:opacity-40">
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="auth-password" value={password} onChange={(e) => setPassword(e.target.value)}
                type="password" autoComplete={mode === "create" ? "new-password" : "current-password"}
                className={inputCls} />
              {mode === "create" && (
                <p className="mt-1.5 text-xs text-white/35">At least 6 characters.</p>
              )}
            </div>
            {mode === "create" && (
              <div className="mt-3">
                {recaptchaError ? (
                  <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
                    {recaptchaError}
                  </p>
                ) : (
                  <>
                    <div id="register-recaptcha" className="flex justify-center" />
                    {needRecaptcha && (
                      <p className="mt-1.5 text-center text-xs text-white/35">Complete the reCAPTCHA to create your account.</p>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="mt-4">
              <button type="submit" disabled={busy || !canSubmitPassword || needRecaptcha} className={primaryBtn}>
                {busy ? (mode === "create" ? "Creating account…" : "Signing in…") : mode === "create" ? "Create account" : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-white/10 bg-[#15151d] p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (phoneConfirm ? handleVerifyCode() : handleSendCode());
            }}
          >
            <div>
              <label htmlFor="auth-phone" className={labelCls}>Phone number</label>
              <input
                id="auth-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
                type="tel" autoComplete="tel" placeholder="+15551234567"
                className={inputCls} />
              <p className="mt-1.5 text-xs text-white/35">We text you a code — no password needed for phones.</p>
            </div>
            {phoneConfirm && (
              <div className="mt-3">
                <label htmlFor="auth-code" className={labelCls}>Verification code</label>
                <input
                  id="auth-code" value={code} onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                  className={inputCls} />
              </div>
            )}
            <div className="mt-4">
              <button
                type="submit"
                disabled={busy || (!phoneConfirm && !phone.trim()) || (!!phoneConfirm && !code.trim())}
                className={primaryBtn}>
                {busy ? "Working…" : phoneConfirm ? "Verify" : "Send code"}
              </button>
            </div>
          </form>
          <div id="recaptcha-container" />
        </div>
      )}

      <div className="mt-4 rounded-lg border border-white/10 px-4 py-3.5 text-center text-sm text-white/60">
        {mode === "signin" && (
          <>New to MS-ROOMS? <button onClick={() => switchMode("create")} className="font-semibold text-violet-300 hover:underline">Create an account</button></>
        )}
        {mode === "create" && (
          <>Already have an account? <button onClick={() => switchMode("signin")} className="font-semibold text-violet-300 hover:underline">Sign in</button></>
        )}
        {mode === "phone" && (
          <>Prefer email? <button onClick={() => switchMode("signin")} className="font-semibold text-violet-300 hover:underline">Back to sign in</button></>
        )}
      </div>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs text-white/25">or continue with</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <button onClick={() => void handleGoogle()} disabled={busy} className={secondaryBtn}>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4285F4] text-xs font-bold text-white">G</span>
        Continue with Google
      </button>

      <div className="mt-3 text-center text-xs text-white/40">
        {mode !== "phone" && (
          <button onClick={() => switchMode("phone")} className="hover:text-white/70 hover:underline">Use phone instead</button>
        )}
        {mode === "signin" && (
          <>
            <span className="mx-2 text-white/10">•</span>
            <button onClick={() => void handleSendLink()} disabled={busy} className="hover:text-white/70 hover:underline disabled:opacity-40">
              Email me a sign-in link
            </button>
          </>
        )}
      </div>
    </div>
  );
}
