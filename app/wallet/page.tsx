"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Coins, Diamond, Dices, History, Zap } from "lucide-react";
import {
  checkin,
  fetchPricing,
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
  const [tiers, setTiers] = useState<Array<Record<string, unknown>>>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [spinOpen, setSpinOpen] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [p, t, pricing] = await Promise.all([rechargePackages(), fetchTransactions(user.id), fetchPricing().catch(() => ({ tiers: [] }))]);
      setPacks(p.packages);
      setTxns(t.transactions);
      setTiers((pricing as { tiers?: Array<Record<string, unknown>> }).tiers ?? []);
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

      {/* 10% Cheaper Pricing */}
      <h2 className="mt-6 text-sm font-bold uppercase tracking-widest text-white/50">10% cheaper — get more for same price</h2>
      <p className="text-xs text-white/35">Market: 25k/$5, 50k/$10, 100k/$20, 500k/$100. We give 27.5k / 55k / 110k / 550k for same fiat — or pay 10% less.</p>
      <div className="mt-2 overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/5 text-white/50">
            <tr><th className="px-3 py-2">Tier</th><th className="px-3 py-2">Market</th><th className="px-3 py-2">Our App (10% more)</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {[
              { id: "starter", std: "25,000", app: "27,500", price: "$5.00" },
              { id: "growth", std: "50,000", app: "55,000", price: "$10.00" },
              { id: "pro", std: "100,000", app: "110,000", price: "$20.00" },
              { id: "enterprise", std: "500,000", app: "550,000", price: "$100.00" },
            ].map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2 font-bold capitalize">{r.id}</td>
                <td className="px-3 py-2 text-white/60">{r.std} @ {r.price}</td>
                <td className="px-3 py-2 font-black text-amber-200">{r.app} @ {r.price} <span className="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200">+10%</span></td>
                <td className="px-3 py-2"><button onClick={() => void buy(r.id)} disabled={busyPack !== null} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black hover:bg-white/85 disabled:opacity-40">{busyPack === r.id ? "…" : "Buy"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tiers.length > 0 && <p className="mt-1 text-xs text-white/30">Source: D1 pricing_tiers — bonus_percent 10.0</p>}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-widest text-white/50">Top up coins (sandbox)</h2>
      <p className="text-xs text-white/35">Small packs for testing — instant credit, no real payment. Hosts earn <Diamond size={10} className="inline text-violet-300" /> Gems at 70% of gift cost.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {packs.filter((p) => p.id.startsWith("p")).map((p) => (
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
