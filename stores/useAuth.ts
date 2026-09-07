"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  frame_style: string;
  id_tag: string;
  xp: number;
  level: number;
  coins: number;
  streak: number;
  last_checkin: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  guestId: string | null;
  hydratated: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  ensureGuestId: () => string;
  logout: () => void;
}

function makeGuestId(): string {
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      guestId: null,
      hydratated: false,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      ensureGuestId: () => {
        const cur = get().guestId;
        if (cur) return cur;
        const id = makeGuestId();
        set({ guestId: id });
        return id;
      },
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: "viberoom-auth",
      partialize: (s) => ({ token: s.token, user: s.user, guestId: s.guestId }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydratated = true;
      },
    }
  )
);
