"use client";

import { create } from "zustand";
import { API_BASE, fetchUser, me as apiMe, ApiError, type ApiUser } from "@/lib/api";
import { clearFirebaseSessionHint, hasFirebaseSessionHint } from "@/lib/firebase-hint";

interface SessionState {
  user: ApiUser | null;
  /** True once the session has been checked. */
  ready: boolean;
  authError: string | null;
  boot: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  ready: false,
  authError: null,

  boot: async () => {
    try {
      const { user } = await apiMe();
      set({ user, ready: true, authError: null });
      return;
    } catch {
      // No D1 session — but Firebase may still hold the identity (redirect
      // sign-in return, expired cookie, fresh tab). Re-mint silently.
    }
    // Only attempt the Firebase re-mint if this browser has actually signed in
    // with Firebase before. Without the hint this fallback runs for every
    // logged-out visitor, importing firebase/auth and the ~347 KB reCAPTCHA
    // App Check script just to conclude there is no session — which made the
    // anonymous landing page pay a ~1.5s main-thread cost it never needed.
    if (!hasFirebaseSessionHint()) {
      set({ user: null, ready: true });
      return;
    }
    try {
      const [{ auth }, { syncFirebaseUser }] = await Promise.all([
        import("@/lib/firebase"),
        import("@/lib/firebase-sync"),
      ]);
      const fbUser = await new Promise<import("@/lib/firebase").User | null>((resolve) => {
        try {
          const unsub = auth.onAuthStateChanged((u) => {
            try { unsub(); } catch {}
            resolve(u);
          });
          setTimeout(() => {
            try { unsub(); } catch {}
            resolve(auth.currentUser);
          }, 4000);
        } catch {
          resolve(auth.currentUser);
        }
      });
      if (fbUser) {
        const { user } = await syncFirebaseUser(fbUser);
        set({ user, ready: true, authError: null });
        return;
      }
    } catch (e) {
      // A 403 ban must be visible (not a silent logout): apiMe and the
      // Firebase re-sync both refuse banned users with "has been banned".
      if (e instanceof ApiError && e.status === 403 && /ban/i.test(e.message)) {
        set({ user: null, ready: true, authError: e.message });
        return;
      }
      // Fall through to logged-out below.
    }
    set({ user: null, ready: true });
  },

  logout: async () => {
    // Clear server sessions first, then Firebase, then local stores.
    // Awaited so a shared device never keeps the next user signed in as admin.
    try {
      const csrfHeaders: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const r = await fetch(`${API_BASE}/api/csrf`, { credentials: "include" });
        const d = (await r.json()) as { csrf_token?: string };
        if (d?.csrf_token) csrfHeaders["X-CSRF-Token"] = d.csrf_token;
      } catch {}
      await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include", headers: csrfHeaders });
    } catch {}
    try {
      await fetch(`${API_BASE}/api/admin/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    } catch {}
    try {
      if (typeof window !== "undefined") localStorage.removeItem("admin_token");
    } catch {}
    try {
      const { clearFirebaseSessionHint } = await import("@/lib/firebase-hint");
      clearFirebaseSessionHint();
    } catch {}
    try {
      const { useCalls } = await import("@/stores/useCalls");
      useCalls.setState({ missed: 0 });
    } catch {}
    try {
      const { auth, signOut } = await import("@/lib/firebase");
      await signOut(auth);
    } catch {}
    set({ user: null, authError: null });
  },

  refresh: async () => {
    const { user } = get();
    if (!user) return;
    try {
      const fresh = (await apiMe()).user;
      set({ user: fresh });
    } catch {
      // Keep the last known user on transient failures.
    }
  },
}));