"use client";

import { create } from "zustand";
import { API_BASE, fetchUser, login as apiLogin, me as apiMe, type ApiUser } from "@/lib/api";

interface SessionState {
  user: ApiUser | null;
  /** True once the session has been checked. */
  ready: boolean;
  authError: string | null;
  boot: () => Promise<void>;
  login: (username: string) => Promise<void>;
  logout: () => void;
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
    } catch {
      // No valid session — start logged out
      set({ user: null, ready: true });
    }
  },

  login: async (username: string) => {
    set({ authError: null });
    try {
      const { user } = await apiLogin(username);
      set({ user, authError: null });
    } catch (e) {
      set({ authError: e instanceof Error ? e.message : "Login failed. Try again." });
      throw e;
    }
  },

  logout: () => {
    // Call backend logout to clear server session and cookie
    fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    // Also sign out Firebase so the next device needs fresh credentials
    try {
      import("@/lib/firebase").then(({ auth, signOut }) => signOut(auth).catch(() => undefined));
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