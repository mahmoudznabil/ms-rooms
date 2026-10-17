"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Coins, Dices, History, Zap } from "lucide-react";
import {
  checkin,
  fetchCoinPackages,
  fetchMyRecharge,
  fetchTransactions,
  requestRecharge,
  type CoinPackage,
  type MyRechargeState,
  type Txn,
} from "@/lib/api";
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
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [recharge, setRecharge] = useState<MyRechargeState | null>(null);

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

  const loadPackages = useCallback(async () => {
    try {
      const r = await fetchCoinPackages();
      setPackages(r.packages ?? []);
    } catch {
      // packages are best-effort; the wallet still works without them
    }
  }, []);

  const loadRecharge = useCallback(async () => {
    try {
      setRecharge(await fetchMyRecharge());
    } catch {
      // best-effort: the wallet is still usable without recharge state
    }
  }, []);

  // Recharges are handled by our team, not a card processor: asking for a pack
  // creates a request and (on the first one) assigns the user to an admin.
  const buyPackage = useCallback(
    async (pkg: CoinPackage) => {
      setBuying(pkg.id);
      setNotice(null);
      try {
        const r = await requestRecharge(pkg.id);
        if (r.ok) {
          setNotice(r.message ?? "Request received.");
          await loadRecharge();
        } else {
          setNotice(r.error || "Could not send that request.");
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not send that request.");
      } finally {
        setBuying(null);
      }
    },
    [loadRecharge]
  );

  useEffect(() => {
    setLoading(true);
    void load();
    void loadPackages();
    void loadRecharge();
  }, [load, loadPackages, loadRecharge]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  if (!user) return null;
  const prog = levelProgress(user.xp);
  // One open request at a time (the server enforces this too — the UI just
  // shows the pending state instead of letting the user queue more).
  const openRequest = recharge?.requests.find((r) => r.status === "open") ?? null;

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
      <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        <div className="min-w-0 rounded-3xl border border-amber-300/20 bg-gradient-to-br from-amber-400/15 to-orange-500/5 p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-200/70">Coins</p>
          <p className="mt-1 truncate text-xl font-black text-amber-200">{(user.coins ?? 0).toLocaleString()}</p>
          <p className="text-xs text-white/40">Hard — bought / recharged</p>
        </div>
        <div className="min-w-0 rounded-3xl border border-violet-300/20 bg-arc-quiet p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-200/70">Gems</p>
          <p className="mt-1 truncate text-xl font-black text-violet-200">{((user as unknown as { gems?: number }).gems ?? 0).toLocaleString()}</p>
          <p className="text-xs text-white/40">Soft — gift earnings 70%</p>
        </div>
        <div className="min-w-0 rounded-3xl border border-emerald-300/20 bg-gradient-to-br from-emerald-500/15 to-teal-500/5 p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-200/70">XP</p>
          <p className="mt-1 truncate text-xl font-black text-emerald-200">{(user.xp ?? 0).toLocaleString()}</p>
          <p className="text-xs text-white/40">Level {prog.level}</p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-white/5 bg-black/20 p-3">
        <div className="flex justify-between text-xs font-semibold text-white/55">
          <span className="flex items-center gap-1"><Zap size={12} /> Lv.{prog.level}</span>
          <span>{(user.xp ?? 0).toLocaleString()} / {prog.target.toLocaleString()} XP</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/30">
          <div className="h-full rounded-full bg-arc" style={{ width: `${prog.pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-white/35">XP from chatting, staying in rooms, sending gifts. Unlocks badges & leaderboard.</p>
        {notice && <p className="mt-3 rounded-xl bg-black/30 px-3 py-2 text-center text-xs font-bold text-amber-100">{notice}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => void doCheckin()} disabled={checkinBusy}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl bg-amber-400 py-2.5 text-sm font-bold text-black transition hover:bg-amber-300 disabled:opacity-50">
            <CalendarCheck size={15} /> {checkinBusy ? "…" : "Daily +100"}
          </button>
          <button onClick={() => setSpinOpen(true)}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl bg-white/10 py-2.5 text-sm font-bold text-white transition hover:bg-white/15">
            <Dices size={15} /> Lucky Spin
          </button>
        </div>
      </div>

      {/* Coin packages: ~$1.08/100 coins, 20% under competitors. Recharges are
          handled by our team — asking for a pack creates a request, and on the
          first one the user is assigned to an admin who confirms payment. */}
      {packages.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/50">Get coins</h2>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {packages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => void buyPackage(pkg)}
                disabled={buying === pkg.id || openRequest != null}
                className="flex min-h-[44px] items-center justify-between gap-3 rounded-2xl border border-amber-300/20 bg-gradient-to-br from-amber-400/10 to-orange-500/5 p-3 text-left transition hover:border-amber-300/40 hover:from-amber-400/20 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-amber-100">{pkg.name}</span>
                  <span className="block truncate text-xs text-white/45">{pkg.value_note}</span>
                </span>
                <span className="shrink-0 rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-black">
                  {buying === pkg.id ? "…" : pkg.price}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-white/35">
            Request a pack and your admin confirms payment, then coins land in your wallet. 20% under the
            competitor median.
          </p>

          {/* Recharge state: who your admin is, and what's outstanding. */}
          {recharge && (
            <div className="mt-3 space-y-2">
              {openRequest ? (
                <div className="rounded-2xl border border-violet-300/25 bg-violet-500/10 px-3 py-2.5">
                  <p className="text-sm font-bold text-violet-100">
                    Request pending — {openRequest.coins.toLocaleString()} coins
                  </p>
                  <p className="mt-0.5 text-xs text-white/55">
                    {recharge.admin
                      ? `${recharge.admin.display_name || recharge.admin.username} is on it.`
                      : "An admin will pick this up shortly."}
                  </p>
                </div>
              ) : (
                recharge.admin && (
                  <p className="text-xs text-white/45">
                    Your admin:{" "}
                    <span className="font-bold text-white/70">
                      {recharge.admin.display_name || recharge.admin.username}
                    </span>
                  </p>
                )
              )}

              {/* Phase 2: the $100 line drawn against the card on file. */}
              {!recharge.in_grace && (
                <div
                  className={`rounded-2xl border px-3 py-2.5 ${
                    recharge.overdue
                      ? "border-red-400/30 bg-red-500/10"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-white/60">Card balance</span>
                    <span className={recharge.overdue ? "text-red-300" : recharge.outstanding_usd > 0 ? "text-amber-300" : "text-emerald-300"}>
                      ${recharge.outstanding_usd.toFixed(2)} / ${recharge.allowance_cap_usd}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/30">
                    <div
                      className={`h-full rounded-full ${recharge.overdue ? "bg-red-400" : "bg-gradient-to-r from-amber-400 to-orange-500"}`}
                      style={{ width: `${Math.min(100, (recharge.outstanding_usd / recharge.allowance_cap_usd) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-white/35">
                    {recharge.overdue
                      ? `A charge is past its ${recharge.settlement_days}-day window — please settle with your admin.`
                      : recharge.outstanding_usd > 0
                        ? `Your card on file is charged when this reaches $${recharge.allowance_cap_usd}. Anything unpaid is due within ${recharge.settlement_days} days.`
                        : `Clear. Your card on file covers you up to $${recharge.allowance_cap_usd}.`}
                  </p>
                </div>
              )}

              {/* Phase 1 progress: pay first, then receive the credit. */}
              {recharge.in_grace && (
                <p className="text-[11px] text-white/35">
                  Prepaid — you pay your admin, then coins land in your wallet.{" "}
                  {recharge.recharge_count} of {recharge.grace_recharges} recharges before card billing
                  opens.
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
            <li key={t.id} className="rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-sm">
              <details>
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-white/75">{t.description || t.type}</span>
                  <span className={`ml-2 shrink-0 font-black ${t.amount >= 0 ? "text-emerald-300" : "text-white/60"}`}>
                    {t.amount >= 0 ? "+" : ""}{t.amount}
                  </span>
                </summary>
                <p className="mt-1 text-xs text-white/50">{t.description || t.type} · {t.created_at}</p>
              </details>
            </li>
          ))}
        </ul>
      )}

      {spinOpen && <SpinModal onClose={() => { setSpinOpen(false); void load(); }} />}
    </div>
  );
}
