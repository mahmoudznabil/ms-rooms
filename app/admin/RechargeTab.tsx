"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleDollarSign, HandCoins, Users } from "lucide-react";
import {
  claimCustomer,
  fetchCoinPackages,
  fulfilRecharge,
  listAdminCustomers,
  listRechargeRequests,
  markCreditPaid,
  releaseCustomer,
  type AdminCustomer,
  type AdminRechargeRequest,
  type CoinPackage,
} from "@/lib/api";
import { UserAvatar } from "@/components/bits";

/**
 * Admin recharge desk.
 *
 * There is no card processor: a user requests a pack, the admin who owns them
 * fulfils it (coins + a ledger row) and collects payment offline. The first
 * time a user asks, the system assigns them to the least-loaded admin, so this
 * tab is mostly "work your queue" plus "grow your base".
 *
 * The money rule lives on the server (workers/recharge-policy.ts): below
 * `grace_recharges` the admin may credit freely; at or above it, the user may
 * carry at most `outstanding_cap_usd` UNPAID credit until an earlier credit is
 * marked paid. This tab surfaces that state per customer rather than
 * re-deriving it, so the two can never disagree.
 */

type Scope = "mine" | "unassigned" | "all";

interface LedgerCredit {
  id: string;
  coins: number;
  usd_cents: number;
  status: "unpaid" | "paid" | "void";
  created_at: string;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 rounded-3xl border border-white/10 bg-[#15151d] p-4">{children}</div>;
}

export default function RechargeTab({
  isMaster,
  canMoney,
}: {
  isMaster: boolean;
  canMoney: boolean;
}) {
  const [scope, setScope] = useState<Scope>("mine");
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [policy, setPolicy] = useState({
    grace_recharges: 30,
    outstanding_cap_usd: 100,
    settlement_days: 7,
  });
  const [queue, setQueue] = useState<AdminRechargeRequest[]>([]);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [detail, setDetail] = useState<{ user_id: string; credits: LedgerCredit[] } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [c, q] = await Promise.all([
        listAdminCustomers(scope),
        listRechargeRequests("open"),
      ]);
      setCustomers(c.customers ?? []);
      setPolicy(c.policy ?? { grace_recharges: 30, outstanding_cap_usd: 100, settlement_days: 7 });
      setQueue(q.requests ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load customers.");
    }
  }, [scope]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchCoinPackages()
        .then((r) => setPackages(r.packages ?? []))
        .catch(() => undefined);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That action failed.");
    } finally {
      setBusy(null);
    }
  };

  const scopes: Array<{ id: Scope; label: string; show: boolean }> = [
    { id: "mine", label: "My customers", show: true },
    { id: "unassigned", label: "Unassigned", show: true },
    { id: "all", label: "Everyone", show: isMaster },
  ];

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {scopes.filter((s) => s.show).map((s) => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
              scope === s.id ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-white/35">
          {policy.grace_recharges} free recharges · then ${policy.outstanding_cap_usd} unpaid cap
        </span>
      </div>

      {err && <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{err}</p>}
      {msg && <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300">{msg}</p>}

      {/* ---- Open requests ---- */}
      {queue.length > 0 && (
        <Card>
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-widest text-white/50">
            <HandCoins size={14} /> Requests waiting ({queue.length})
          </h2>
          <ul className="mt-2 space-y-2">
            {queue.map((r) => {
              const overCap = !r.recharge_count || r.recharge_count >= policy.grace_recharges
                ? r.outstanding_usd >= policy.outstanding_cap_usd
                : false;
              return (
                <li key={r.id} className="rounded-2xl bg-white/[0.04] p-3">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={r.display_name} avatarUrl={r.avatar_url} size={34} showFrame={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{r.display_name}</p>
                      <p className="truncate text-xs text-white/45">
                        @{r.username} · {r.coins.toLocaleString()} coins ·{" "}
                        {r.recharge_count < policy.grace_recharges
                          ? `recharge ${r.recharge_count + 1} of ${policy.grace_recharges}`
                          : `outstanding $${r.outstanding_usd.toFixed(2)}`}
                      </p>
                    </div>
                    {canMoney && (
                      <button
                        disabled={busy === `f:${r.id}` || overCap}
                        onClick={() =>
                          void act(`f:${r.id}`, () =>
                            fulfilRecharge({ request_id: r.id, note }).then((res) => {
                              if (!res.ok) throw new Error(res.error || "Could not fulfil.");
                              setMsg(`Credited ${res.coins?.toLocaleString()} coins to @${r.username}.`);
                              setNote("");
                            })
                          )
                        }
                        className="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black transition hover:bg-emerald-400 disabled:opacity-40"
                      >
                        {busy === `f:${r.id}` ? "…" : overCap ? "Cap reached" : "Fulfil"}
                      </button>
                    )}
                  </div>
                  {canMoney && packages.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-white/35">
                      Charges the user pays you:{" "}
                      {packages.find((p) => p.id === r.package_id)?.price ?? "—"}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* ---- Customer base ---- */}
      <Card>
        <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-widest text-white/50">
          <Users size={14} /> {scope === "unassigned" ? "Unassigned users" : "Customers"} ({customers.length})
        </h2>

        {customers.length === 0 ? (
          <p className="mt-3 text-sm text-white/45">
            {scope === "mine"
              ? "No customers yet. New top-up requests land here automatically."
              : scope === "unassigned"
                ? "Everyone has an admin. New users appear here until they request a top-up."
                : "No users found."}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {customers.map((c) => (
              <li key={c.user_id} className="rounded-2xl bg-white/[0.04] p-3">
                <div className="flex items-center gap-2.5">
                  <UserAvatar name={c.display_name} avatarUrl={c.avatar_url} size={34} showFrame={false} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{c.display_name}</p>
                    <p className="truncate text-xs text-white/45">
                      @{c.username} · {c.coins.toLocaleString()} coins
                      {c.admin_username ? ` · @${c.admin_username}` : ""}
                    </p>
                  </div>
                  {scope === "unassigned" ? (
                    <button
                      disabled={busy === `c:${c.user_id}`}
                      onClick={() => void act(`c:${c.user_id}`, () => claimCustomer(c.user_id))}
                      className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-black text-black transition hover:bg-white/85 disabled:opacity-40"
                    >
                      {busy === `c:${c.user_id}` ? "…" : "Add"}
                    </button>
                  ) : scope === "mine" ? (
                    <button
                      disabled={busy === `r:${c.user_id}`}
                      onClick={() => void act(`r:${c.user_id}`, () => releaseCustomer(c.user_id))}
                      className="shrink-0 rounded-xl bg-white/5 px-3 py-2 text-xs font-bold text-white/60 transition hover:bg-white/10 disabled:opacity-40"
                    >
                      Release
                    </button>
                  ) : null}
                </div>

                {/* Allowance state + settle controls */}
                {c.recharge_count > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                        c.overdue
                          ? "bg-red-500/25 text-red-200"
                          : c.phase === "prepaid"
                            ? "bg-violet-500/20 text-violet-200"
                            : c.outstanding_usd > 0
                              ? "bg-amber-500/20 text-amber-200"
                              : "bg-emerald-500/20 text-emerald-200"
                      }`}
                    >
                      {c.overdue
                        ? `overdue ${policy.settlement_days}+d`
                        : c.phase === "prepaid"
                          ? `prepaid ${c.recharge_count}/${policy.grace_recharges}`
                          : c.outstanding_usd > 0
                            ? `outstanding $${c.outstanding_usd.toFixed(2)}`
                            : "postpaid clear"}
                    </span>
                    {c.phase === "postpaid" && !c.overdue && (
                      <span className="text-[10px] text-white/35">
                        card charged when the ${policy.outstanding_cap_usd} line is reached
                      </span>
                    )}
                    {c.open_requests > 0 && (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/70">
                        {c.open_requests} pending
                      </span>
                    )}
                    <button
                      disabled={busy === `d:${c.user_id}`}
                      onClick={() =>
                        void act(`d:${c.user_id}`, async () => {
                          const res = await fetch(`/api/admin/recharge/ledger?user_id=${encodeURIComponent(c.user_id)}`, {
                            credentials: "include",
                            headers: { Accept: "application/json" },
                          });
                          const data = (await res.json()) as {
                            ok: boolean;
                            credits?: Array<{ id: string; status: string; usd_cents: number; created_at: string }>;
                            error?: string;
                          };
                          if (!data.ok) throw new Error(data.error || "Could not load the ledger.");
                          const unpaid = (data.credits ?? []).filter((x) => x.status === "unpaid");
                          if (unpaid.length === 0) {
                            setMsg(`@${c.username} has nothing unpaid.`);
                            return;
                          }
                          setDetail({
                            user_id: c.user_id,
                            credits: unpaid.map((u) => ({
                              id: u.id,
                              coins: 0,
                              usd_cents: u.usd_cents,
                              status: "unpaid" as const,
                              created_at: u.created_at,
                            })),
                          });
                        })
                      }
                      className="ml-auto rounded-lg bg-white/5 px-2 py-1 text-[11px] font-bold text-white/70 hover:bg-white/10 disabled:opacity-40"
                    >
                      <CircleDollarSign size={11} className="mr-1 inline" />
                      Mark paid
                    </button>
                  </div>
                )}

                {detail?.user_id === c.user_id && (
                  <ul className="mt-2 space-y-1">
                    {detail.credits.map((cr) => (
                      <li key={cr.id} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-2.5 py-1.5">
                        <span className="truncate text-xs text-white/60">
                          ${(cr.usd_cents / 100).toFixed(2)} · {cr.created_at}
                        </span>
                        {canMoney && (
                          <button
                            disabled={busy === `p:${cr.id}`}
                            onClick={() =>
                              void act(`p:${cr.id}`, () =>
                                markCreditPaid(cr.id).then((r) => {
                                  if (!r.ok) throw new Error("Could not settle that credit.");
                                  setMsg(`Settled — @${c.username} now has $${r.outstanding_usd.toFixed(2)} outstanding.`);
                                  setDetail(null);
                                })
                              )
                            }
                            className="shrink-0 rounded-lg bg-emerald-500 px-2 py-1 text-[11px] font-black text-black disabled:opacity-40"
                          >
                            <BadgeCheck size={11} className="mr-1 inline" />
                            Paid
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}