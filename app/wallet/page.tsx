"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Coins, Dices, History, Zap } from "lucide-react";
import { checkin, fetchTransactions, type Txn } from "@/lib/api";
import { levelProgress } from "@/lib/levels";
import { useSession } from "@/stores/useSession";
import { EmptyState, Spinner } from "@/components/bits";
import SpinModal from "@/components/SpinModal";

export default function WalletPage() {
  const user = useSession((s) => s.user);
  const refresh = useSession((s) => s.refresh);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinOpen, setSpinOpen] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const t = await fetchTransactions(user.id);
      setTxns(t.transactions);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  if (!user) return null;
  const prog = levelProgress(user.xp);

  const doCheckin = async () => {
    setCheckinBusy(true);
    try {
      const r = await checkin(user.id);
      await refresh();
      setNotice(`Checked in! +${r.credited} coins · ${r.streak}-day streak. +10 XP`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Check-in failed.");
    } finally {
      setCheckinBusy(false);
    }
  };

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
        <Coins size={22} className="text-amber-300" /> Wallet
      </h1>

      {/* Triple-Currency Header */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-3xl border border-amber-300/20 bg-gradient-to-br from-amber-400/15 to-orange-500/5 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-200/70">Coins</p>
          <p className="mt-1 text-2xl font-black text-amber-200">{(user.coins ?? 0).toLocaleString()}</p>
          <p className="text-xs text-white/40">Hard — bought / recharged</p>
        </div>
        <div className="rounded-3xl border border-violet-300/20 bg-gradient-to-br from-violet-500/15 to-fuchsia-500/5 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-200/70">Gems</p>
          <p className="mt-1 text-2xl font-black text-violet-200">{((user as unknown as { gems?: number }).gems ?? 0).toLocaleString()}</p>
          <p className="text-xs text-white/40">Soft — gift earnings 70%</p>
        </div>
        <div className="rounded-3xl border border-emerald-300/20 bg-gradient-to-br from-emerald-500/15 to-teal-500/5 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-200/70">XP</p>
          <p className="mt-1 text-2xl font-black text-emerald-200">{(user.xp ?? 0).toLocaleString()}</p>
          <p className="text-xs text-white/40">Level {prog.level}</p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-white/5 bg-black/20 p-3">
        <div className="flex justify-between text-xs font-semibold text-white/55">
          <span className="flex items-center gap-1"><Zap size={12} /> Lv.{prog.level}</span>
          <span>{(user.xp ?? 0).toLocaleString()} / {prog.target.toLocaleString()} XP</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/30">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${prog.pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-white/35">XP from chatting, staying in rooms, sending gifts. Unlocks badges & leaderboard.</p>
        {notice && <p className="mt-3 rounded-xl bg-black/30 px-3 py-2 text-center text-xs font-bold text-amber-100">{notice}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => void doCheckin()} disabled={checkinBusy}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-amber-400 py-2.5 text-sm font-bold text-black transition hover:bg-amber-300 disabled:opacity-50">
            <CalendarCheck size={15} /> {checkinBusy ? "…" : "Daily +100"}
          </button>
          <button onClick={() => setSpinOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 py-2.5 text-sm font-bold text-white transition hover:bg-white/15">
            <Dices size={15} /> Lucky Spin
          </button>
        </div>
      </div>

      {/* Coin purchases removed (Phase 1.5): the sandbox top-up granted coins for
          free with no payment. Coins are earned-only until the gated IAP workstream
          (docs/PRODUCTION-PLAN.md Phase 6) adds a server-verified purchase path. */}

      <h2 className="mt-6 flex items-center gap-1.5 text-sm font-bold uppercase tracking-widest text-white/50">
        <History size={14} /> Recent activity
      </h2>
      {loading ? (
        <Spinner />
      ) : txns.length === 0 ? (
        <div className="mt-2"><EmptyState title="No activity yet" hint="Check in, spin, or send a gift. Gifts give +2 XP and host earns 70% as Gems." /></div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {txns.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-white/75">{t.description || t.type}</span>
              <span className={`ml-2 font-black ${t.amount >= 0 ? "text-emerald-300" : "text-white/60"}`}>
                {t.amount >= 0 ? "+" : ""}{t.amount}
              </span>
            </li>
          ))}
        </ul>
      )}

      {spinOpen && <SpinModal onClose={() => { setSpinOpen(false); void load(); }} />}
    </div>
  );
}
