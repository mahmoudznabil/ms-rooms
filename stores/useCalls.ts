"use client";

import { create } from "zustand";
import { missedCallCount } from "@/lib/api";

interface CallsState {
  missed: number;
  refreshMissed: () => Promise<void>;
  clearMissedLocal: () => void;
}

export const useCalls = create<CallsState>((set) => ({
  missed: 0,
  refreshMissed: async () => {
    try {
      const { missed } = await missedCallCount();
      set({ missed });
    } catch {
      // Badge stays put on transient failures.
    }
  },
  clearMissedLocal: () => set({ missed: 0 }),
}));
