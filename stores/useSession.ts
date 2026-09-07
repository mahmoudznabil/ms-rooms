"use client";

import { create } from "zustand";
import { fetchUser, login as apiLogin, me as apiMe, type ApiUser } from "@/lib/api";

const TOKEN_KEY = "viberoom_token";
const UID_KEY = "viberoom_uid";

interface SessionState {
  token: string | null;
  user: ApiUser | null;
  /** True once localStorage has been read and the session revalidated. */
  ready: boolean;
  authError: string | null;
  boot: () => Promise<void>;
  login: (username: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

function readStorage(): { token: string | null; uid: string | null } {
  if (typeof window === "undefined") return { token: null, uid: null };
  try {
    return {
      token: window.localStorage.getItem(TOKEN_KEY),
      uid: window.localStorage.getItem(UID_KEY),
    };
  } catch {
    return { token: null, uid: null };
  }
}

function writeStorage(token: string | null, uid: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token && uid) {
      window.localStorage.setItem(TOKEN_KEY, token);
      window.localStorage.setItem(UID_KEY, uid);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(UID_KEY);
    }
  } catch {
    // Storage unavailable (private mode) — session simply won't persist.
  }
}

export const useSession = create<SessionState>((set, get) => ({
  token: null,
  user: null,
  ready: false,
  authError: null,

  boot: async () => {
    const { token } = readStorage();
    if (!token) {
      set({ ready: true });
      return;
    }
    try {
      const { user } = await apiMe(token);
      set({ token, user, ready: true, authError: null });
    } catch {
      // Token expired or backend unreachable: fall back to stored uid balance,
      // otherwise start logged out. Never leave the app stuck loading.
      const { uid } = readStorage();
      if (uid) {
        try {
          const { user } = await fetchUser(uid);
          set({ token: null, user, ready: true });
          return;
        } catch {
          // ignore — fall through to logged-out
        }
      }
      writeStorage(null, null);
      set({ token: null, user: null, ready: true });
    }
  },

  login: async (username: string) => {
    set({ authError: null });
    try {
      const { user, token } = await apiLogin(username);
      writeStorage(token, user.id);
      set({ token, user, authError: null });
    } catch (e) {
      set({ authError: e instanceof Error ? e.message : "Login failed. Try again." });
      throw e;
    }
  },

  logout: () => {
    writeStorage(null, null);
    // Also sign out Firebase so the next device needs fresh credentials
    try {
      import("@/lib/firebase").then(({ auth, signOut }) => signOut(auth).catch(() => undefined));
    } catch {}
    set({ token: null, user: null, authError: null });
  },

  refresh: async () => {
    const { user, token } = get();
    if (!user) return;
    try {
      const fresh = token ? (await apiMe(token)).user : (await fetchUser(user.id)).user;
      set({ user: fresh });
    } catch {
      // Keep the last known user on transient failures.
    }
  },
}));
