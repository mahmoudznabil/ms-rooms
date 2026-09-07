"use client";

import { useEffect, useState } from "react";
import { Coins, Gift, X, Flame } from "lucide-react";
import { checkin } from "@/lib/api";
import { useSession } from "@/stores/useSession";

const SEEN_KEY = "viberoom_checkin_seen";

function todayKey(): string {
  return new Date().toDateString();
}

function seenKey(uid: string): string {
  return `${SEEN_KEY}:${uid}:${todayKey()}`;
}

export default function ServerCheckinModal() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ credited: number; streak: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const user = useSession((s) => s.user);
  const ready = useSession((s) => s.ready);
  const refresh = useSession((s) => s.refresh);

  useEffect(() => {
    if (!ready || !user) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(seenKey(user.id)) === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    const t = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(t);
  }, [ready, user]);

  if (!open || !user) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(seenKey(user.id), "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await checkin(user.id);
      setResult({ credited: r.credited, streak: r.streak });
      await refresh();
    } catch (e) {
      // Already claimed on another device → treat as done for today.
      if (e instanceof Error && /already checked in/i.test(e.message)) {
        dismiss();
        return;
      }
      setError(e instanceof Error ? e.message : "Check-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="modal-pop w-full max-w-xs rounded-3xl border border-white/10 bg-[#17171f] p-6 text-center shadow-2xl">
        <div className="mb-1 flex justify-end">
          <button
            aria-label="Close check-in"
            onClick={dismiss}
            className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
          <Gift size={28} />
        </div>
        <h2 className="text-lg font-bold text-white">Daily check-in</h2>
        {result ? (
          <>
            <p className="mt-1 text-sm text-white/60">
              +{result.credited} coins added — plus 10 XP for showing up.
            </p>
            <p className="mt-2 flex items-center justify-center gap-1 text-sm font-bold text-orange-300">
              <Flame size={15} /> {result.streak}-day streak
            </p>
            <button
              onClick={dismiss}
              className="mt-4 w-full rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              Keep exploring
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-white/60">Claim 100 free coins and build your streak.</p>
            <div className="mt-3 flex items-center justify-center gap-1 text-sm text-amber-200">
              <Coins size={15} />
              <span className="font-semibold">{user.coins.toLocaleString()} coins</span>
            </div>
            {error && (
              <p className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>
            )}
            <button
              onClick={() => void claim()}
              disabled={busy}
              className="mt-4 w-full rounded-2xl bg-amber-400 py-3 text-sm font-bold text-black transition hover:bg-amber-300 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? "Claiming…" : "Claim +100"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
