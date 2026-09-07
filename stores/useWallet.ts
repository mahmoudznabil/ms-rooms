"use client";

import { create } from "zustand";
import { DAILY_REWARD_AMOUNT } from "@/lib/rooms";

interface WalletState {
  coins: number;
  lastClaimDay: string | null;
  addCoins: (amount: number) => void;
  spendCoins: (amount: number) => boolean;
  canClaimToday: () => boolean;
  claimDailyReward: () => number;
}

function todayKey(): string {
  return new Date().toDateString();
}

export const useWallet = create<WalletState>((set, get) => ({
  coins: 2480,
  lastClaimDay: null,
  addCoins: (amount) =>
    set((s) => ({ coins: Math.max(0, s.coins + amount) })),
  spendCoins: (amount) => {
    const { coins } = get();
    if (coins < amount) return false;
    set({ coins: coins - amount });
    return true;
  },
  canClaimToday: () => get().lastClaimDay !== todayKey(),
  claimDailyReward: () => {
    if (get().lastClaimDay === todayKey()) return 0;
    set((s) => ({
      coins: s.coins + DAILY_REWARD_AMOUNT,
      lastClaimDay: todayKey(),
    }));
    return DAILY_REWARD_AMOUNT;
  },
}));
