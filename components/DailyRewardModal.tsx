"use client";

import { useEffect, useState } from "react";
import { Coins, X, Gift } from "lucide-react";
import { useWallet } from "@/stores/useWallet";
import { DAILY_REWARD_AMOUNT } from "@/lib/rooms";

export default function DailyRewardModal() {
  const [open, setOpen] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const coins = useWallet((s) => s.coins);
  const canClaimToday = useWallet((s) => s.canClaimToday);
  const claimDailyReward = useWallet((s) => s.claimDailyReward);

  useEffect(() => {
    // Initial render is null on both server and client (open === false), so
    // there is no hydration mismatch. Only the timeout callback updates state.
    const t = setTimeout(() => {
      if (canClaimToday()) setOpen(true);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const handleClaim = () => {
    const amount = claimDailyReward();
    if (amount > 0) setClaimed(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="modal-pop w-full max-w-xs rounded-3xl border border-white/10 bg-[#17171f] p-6 text-center shadow-2xl">
        <div className="mb-1 flex justify-end">
          <button
            aria-label="Close reward"
            onClick={() => setOpen(false)}
            className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
          <Gift size={28} />
        </div>
        <h2 className="text-lg font-bold text-white">Daily check-in</h2>
        <p className="mt-1 text-sm text-white/60">
          {claimed
            ? "Reward added. Come back tomorrow for more."
            : `Claim ${DAILY_REWARD_AMOUNT} free coins to keep the party going.`}
        </p>
        <div className="mt-3 flex items-center justify-center gap-1 text-sm text-amber-200">
          <Coins size={15} />
          <span className="font-semibold">{coins.toLocaleString()} coins</span>
        </div>
        {claimed ? (
          <button
            onClick={() => setOpen(false)}
            className="mt-4 w-full rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            Keep exploring
          </button>
        ) : (
          <button
            onClick={handleClaim}
            className="mt-4 w-full rounded-2xl bg-amber-400 py-3 text-sm font-bold text-black transition hover:bg-amber-300 active:scale-[0.98]"
          >
            Claim +{DAILY_REWARD_AMOUNT}
          </button>
        )}
      </div>
    </div>
  );
}
