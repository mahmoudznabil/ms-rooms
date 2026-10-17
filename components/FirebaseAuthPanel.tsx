"use client";

import { useEffect, useState } from "react";
import {
  auth,
  googleProvider,
  getRecaptcha,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  getAppCheckInitError,
} from "@/lib/firebase";
import {
  LegalConsentRequiredError,
  recordLegalConsent,
  syncFirebaseUser,
} from "@/lib/firebase-sync";
import LegalConsentGate from "@/components/LegalConsentGate";
import { useSession } from "@/stores/useSession";
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
  const msg = err instanceof Error ? err.message : String(e);
  // Full technical detail goes to the console only. Users get plain language —
  // a raw `{code: auth/...}` dump is a dead end for everyone except developers.
  try {
    console.error("[auth]", code, msg, (err?.customData ?? e) as unknown);
  } catch {}
  if (code.includes("app-check") || msg.toLowerCase().includes("app check")) {
    return "A security check failed. Try again, or use phone sign-in instead.";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "The Google window closed before finishing. Tap again to retry.";
  }
  if (code === "auth/network-request-failed") {
    return "Could not reach Google. Check your connection and try again.";
  }
  if (code === "auth/unauthorized-domain") {
    return "Google sign-in is not enabled for this site yet. Use email or phone instead.";
  }
  if (code === "auth/operation-not-allowed") {
    return "This sign-in method is switched off. Use email or phone instead.";
  }
  if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
    return "No account matches that email and password. Check them, or create an account.";
  }
  if (code === "auth/wrong-password") {
    return "Wrong password. Try again or reset it with Forgot password.";
  }
  if (code === "auth/email-already-in-use" || code === "auth/credential-already-in-use") {
    return "That email already has an account. Sign in instead.";
  }
  if (code === "auth/weak-password") {
    return "Use a password with at least 6 characters.";
  }
  if (code === "auth/invalid-email") {
    return "That email address does not look right. Check it and try again.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (code === "auth/invalid-verification-code") {
    return "That code is wrong. Check the SMS and try again.";
  }
  if (code === "auth/code-expired") {
    return "That code expired. Send a new one.";
  }
  return "Sign-in did not complete. Try again, or use a different method.";
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-base text-white placeholder:text-white/25 focus:border-violet-400/60 focus:outline-none focus:ring-1 focus:ring-violet-400/30";
const labelCls = "mb-1.5 block text-sm font-semibold text-white/85";
const primaryBtn =
  "w-full rounded-lg bg-white py-2 min-h-[44px] text-sm font-semibold text-black transition hover:bg-white/85 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40";
const secondaryBtn =
  "flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 py-2 min-h-[44px] text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-40";

export default function FirebaseAuthPanel() {
  const [mode, setMode] = useState<Mode>("signin");
  // Held while the legal consent gate is open at signup: the Firebase user
  // whose token the acceptance has to be recorded against.
  const [consentUser, setConsentUser] = useState<import("firebase/auth").User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phoneConfirm, setPhoneConfirm] = useState<import("firebase/auth").ConfirmationResult | null>(null);
  const appCheckInitFailed = Boolean(getAppCheckInitError());

  const switchMode = (m: Mode) => {
    setErr(null);
    setMsg(null);
    setPhoneConfirm(null);
    setMode(m);
  };

  // NOTE: the registration reCAPTCHA v2 checkbox was removed. Its site key was
  // issued for the previous Firebase project and can never validate against the
  // current domain, which left signup permanently blocked. Firebase Auth still
  // applies its own rate limiting and abuse protection to email sign-up, and
  // phone sign-in keeps its mandatory App Check challenge regardless.

  const establishSession = async (fbUser: import("firebase/auth").User) => {
    const { user, isNew } = await syncFirebaseUser(fbUser);
    useSession.setState({ user, ready: true, authError: null });
    // First-run onboarding tour (AppShell picks this up after redirect).
    if (isNew) {
      try {
        sessionStorage.setItem("msrooms_new_signup", "1");
      } catch {}
    }
  };

  const afterFirebase = async (fbUser: import("firebase/auth").User) => {
    try {
      await establishSession(fbUser);
    } catch (e) {
      // ---- Legal consent gate --------------------------------------------------
      // The server refuses to create an account (HTTP 428) until the Terms,
      // Privacy Policy and Community Guidelines have been accepted. That refusal
      // is EXPECTED on a first signup, so it opens the gate rather than
      // surfacing as an error the user cannot act on.
      //
      // The Firebase user is held in state because acceptance has to be recorded
      // against its ID token — at this point there is no app session and no
      // account row, so there is nothing else to key the consent on. Holding it
      // also means they are not asked to sign in again after reading.
      if (e instanceof LegalConsentRequiredError) {
        setConsentUser(fbUser);
        setMsg(null);
        return;
      }
      throw e;
    }
  };

  /** Record consent against the Firebase token, then retry the account creation. */
  const acceptAtSignup = async (payload: {
    lang: "en" | "ar";
    docs: Array<{ key: string; version: string }>;
    ageConfirmed: boolean;
  }) => {
    const fbUser = consentUser;
    if (!fbUser) throw new Error("Your sign-in expired — please try again.");
    const idToken = await fbUser.getIdToken(true);
    await recordLegalConsent(idToken, payload);
    await establishSession(fbUser);
    setConsentUser(null);
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
              ` If that says auth/unauthorized-domain, add ms-rooms.pages.dev under Firebase Console → Authentication → Settings → Authorized domains. Otherwise allow third-party cookies for this site, or use phone sign-in.`
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
      const appCheckBroken = code.includes("app-check") || msg.toLowerCase().includes("app check");
      const popupBroken =
        code === "auth/popup-blocked" ||
        code === "auth/popup-closed-by-user" ||
        code === "auth/network-request-failed" ||
        code === "auth/cancelled-popup-request" ||
        (code === "auth/internal-error" && /popup|window|resolver/i.test(msg));
      if (appCheckBroken) {
        logAuthEvent("google", "failure", msg);
        setErr(formatAuthError(e));
      } else if (popupBroken && code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        // Browsers with strict popup blocking (Edge, Brave, Firefox ETP,
        // Safari ITP) kill the popup before the user ever sees it. Don't show
        // an error — continue with a full-page redirect instead, which no
        // popup blocker can intercept. The mount effect above completes it.
        logAuthEvent("google", "failure", `popup fallback: ${code || msg}`);
        try {
          sessionStorage.setItem("msrooms_google_redirect", "1");
        } catch {}
        setMsg("Opening Google sign-in…");
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (re: unknown) {
          try {
            sessionStorage.removeItem("msrooms_google_redirect");
          } catch {}
          logAuthEvent("google", "failure", re instanceof Error ? re.message : undefined);
          setErr(formatAuthError(re));
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
      setMsg(create ? "Creating your Firebase account…" : "Signing in…");
      const cred = create
        ? await createUserWithEmailAndPassword(auth, email.trim(), password)
        : await signInWithEmailAndPassword(auth, email.trim(), password);
      setMsg("Saving your profile securely…");
      await afterFirebase(cred.user);
      logAuthEvent("email", "success");
      setMsg(create ? "Account created." : "Signed in.");
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
      {appCheckInitFailed && !err && (
        <div role="alert" className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
          Security verification could not initialize. Firebase sign-in may be rejected until the web App Check v3 key is registered for this app.
        </div>
      )}

      {mode !== "phone" ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-ink-raised shadow-raised border-line-strong p-4">
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
                type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" placeholder="you@example.com"
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
            <div className="mt-4">
              <button type="submit" disabled={busy || !canSubmitPassword} className={primaryBtn}>
                {busy ? (mode === "create" ? "Creating account…" : "Signing in…") : mode === "create" ? "Create account" : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-white/10 bg-ink-raised shadow-raised border-line-strong p-4">
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
          <>New to MS-ROOMS? <button onClick={() => switchMode("create")} className="inline-block px-2 py-2.5 min-h-[44px] font-semibold text-violet-300 hover:underline">Create an account</button></>
        )}
        {mode === "create" && (
          <>Already have an account? <button onClick={() => switchMode("signin")} className="inline-block px-2 py-2.5 min-h-[44px] font-semibold text-violet-300 hover:underline">Sign in</button></>
        )}
        {mode === "phone" && (
          <>Prefer email? <button onClick={() => switchMode("signin")} className="inline-block px-2 py-2.5 min-h-[44px] font-semibold text-violet-300 hover:underline">Back to sign in</button></>
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
          <button onClick={() => switchMode("phone")} className="inline-block px-2 py-2.5 min-h-[44px] hover:text-white/70 hover:underline">Use phone instead</button>
        )}
        {mode === "signin" && (
          <>
            <span className="mx-2 text-white/10">•</span>
          </>
        )}
      </div>

      {/* Legal consent gate (Phase F3).
          Opens in response to the server's 428 on a first signup, and is not
          dismissable: there is no account behind it yet, so there is nothing to
          return to. */}
      {consentUser && (
        <LegalConsentGate mode="signup" dismissable={false} onSubmit={acceptAtSignup} />
      )}
    </div>
  );
}
