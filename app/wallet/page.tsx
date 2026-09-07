"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Coins, Dices, History, Zap } from "lucide-react";
import {
  checkin,
  fetchTransactions,
  rechargeBuy,
  rechargePackages,
  type RechargePack,
  type Txn,
} from "@/lib/api";
import { levelProgress } from "@/lib/levels";
import { useSession } from "@/stores/useSession";
import { EmptyState, Spinner } from "@/components/bits";
import SpinModal from "@/components/SpinModal";

export default function WalletPage() {
  const user = useSession((s) => s.user);
  const refresh = useSession((s) => s.refresh);
  const [packs, setPacks] = useState<RechargePack[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [spinOpen, setSpinOpen] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [p, t] = await Promise.all([rechargePackages(), fetchTransactions(user.id)]);
      setPacks(p.packages);
      setTxns(t.transactions);
    } catch {
      // Balances stay visible; lists simply stay empty.
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
      setNotice(`Checked in! +${r.credited} coins · ${r.streak}-day streak.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Check-in failed.");
    } finally {
      setCheckinBusy(false);
    }
  };

  const buy = async (id: string) => {
    setBusyPack(id);
    try {
      const r = await rechargeBuy(user.id, id);
      await refresh();
      await load();
      setNotice(`Topped up +${r.credited} coins. Enjoy the party!`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Top-up failed.");
    } finally {
      setBusyPack(null);
    }
  };

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
        <Coins size={22} className="text-amber-300" /> Wallet
      </h1>

      <div className="mt-4 rounded-3xl border border-amber-300/20 bg-gradient-to-br from-amber-400/15 to-orange-500/5 p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-200/70">Coin balance</p>
        <p className="mt-1 text-4xl font-black text-amber-200">{user.coins.toLocaleString()}</p>
        <div className="mt-3">
          <div className="flex justify-between text-xs font-semibold text-white/55">
            <span className="flex items-center gap-1"><Zap size={12} /> Lv.{prog.level}</span>
            <span>{user.xp.toLocaleString()} / {prog.target.toLocaleString()} XP</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/30">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${prog.pct}%` }} />
          </div>
        </div>
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

      <h2 className="mt-6 text-sm font-bold uppercase tracking-widest text-white/50">Top up coins</h2>
      <p className="text-xs text-white/35">Sandbox top-up for testing — credits instantly, no real payment.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {packs.map((p) => (
          <button key={p.id} onClick={() => void buy(p.id)} disabled={busyPack !== null}
            className="rounded-2xl border border-white/10 bg-[#15151d] p-3 text-left transition hover:border-amber-300/40 active:scale-[0.98] disabled:opacity-50">
            <p className="flex items-center gap-1 text-base font-black text-amber-200"><Coins size={15} />{p.coins.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-white/50">{busyPack === p.id ? "Processing…" : p.price}</p>
          </button>
        ))}
      </div>

      <h2 className="mt-6 flex items-center gap-1.5 text-sm font-bold uppercase tracking-widest text-white/50">
        <History size={14} /> Recent activity
      </h2>
      {loading ? (
        <Spinner />
      ) : txns.length === 0 ? (
        <div className="mt-2"><EmptyState title="No activity yet" hint="Check in, spin, or send a gift to get started." /></div>
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
