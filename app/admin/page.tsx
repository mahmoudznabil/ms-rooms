"use client";

import { useEffect, useState } from "react";
import { Shield, Coins, Diamond, Zap, Ticket, Search, History } from "lucide-react";
import { adminLogin, adminMe, adminRecharge, adminTransactions, adminLookupUsers, adminStats, listTickets, type AdminUser } from "@/lib/api";

const ADMIN_TOKEN_KEY = "admin_token";

export default function AdminPage() {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"recharge" | "tickets" | "audit" | "stats">("recharge");

  // Recharge state
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<Array<{ id: string; username: string; display_name: string; coins: number; gems: number; xp: number }>>([]);
  const [target, setTarget] = useState("");
  const [action, setAction] = useState<"ADD_COINS" | "DEDUCT_COINS" | "ADD_GEMS" | "DEDUCT_GEMS" | "ADD_XP" | "DEDUCT_XP">("ADD_COINS");
  const [amount, setAmount] = useState(1000);
  const [notes, setNotes] = useState("");
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [tickets, setTickets] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem(ADMIN_TOKEN_KEY) : null;
    if (t) {
      setToken(t);
      adminMe(t).then((r) => setAdmin(r.admin)).catch(() => { localStorage.removeItem(ADMIN_TOKEN_KEY); setToken(null); });
    }
  }, []);

  const login = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await adminLogin(username.trim(), password);
      localStorage.setItem(ADMIN_TOKEN_KEY, r.token);
      setToken(r.token); setAdmin(r.admin);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const logout = () => { localStorage.removeItem(ADMIN_TOKEN_KEY); setToken(null); setAdmin(null); };

  const doLookup = async () => {
    if (!token) return;
    try { const r = await adminLookupUsers(token, lookup.trim()); setFound(r.users as unknown as typeof found); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const doRecharge = async () => {
    if (!token || !target) return;
    setBusy(true); setErr(null);
    try {
      await adminRecharge(token, { target_user_id: target, action_type: action, amount: Number(amount), notes });
      setErr(null); alert(`Success: ${action} ${amount} for ${target}`);
      const a = await adminTransactions(token, 20); setAudit(a.transactions);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const loadAudit = async () => { if (!token) return; const a = await adminTransactions(token, 50); setAudit(a.transactions); };
  const loadStats = async () => { if (!token) return; try { const s = await adminStats(token); setStats(s.stats as Record<string, unknown>); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const loadTickets = async () => { if (!token) return; const t = await listTickets({ adminToken: token }); setTickets(t.tickets as unknown as typeof tickets); };

  useEffect(() => { if (admin && tab === "audit") void loadAudit(); if (admin && tab === "stats") void loadStats(); if (admin && tab === "tickets") void loadTickets(); }, [admin, tab]);

  if (!admin || !token) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-[#15151d] p-6">
        <h1 className="flex items-center gap-2 text-xl font-black"><Shield size={20} /> Admin Panel</h1>
        <p className="mt-1 text-xs text-white/50">Master Admin / Finance / Support — seeded password <code className="rounded bg-white/10 px-1">Admin123!</code> (users: master, finance, support)</p>
        <div className="mt-4 space-y-3">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (master/finance/support)" className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" />
          {err && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{err}</p>}
          <button onClick={login} disabled={busy} className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-50">{busy ? "…" : "Sign in as admin"}</button>
        </div>
      </div>
    );
  }

  const role = admin.role;
  const canRecharge = role === "master_admin" || role === "finance";
  const canTickets = role === "master_admin" || role === "support";
  const canAudit = role === "master_admin" || role === "finance";
  const canStats = role === "master_admin";

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-black"><Shield size={20} /> Admin — {admin.display_name} <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-200">{role}</span></h1>
        <button onClick={logout} className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10">Exit</button>
      </div>

      <div className="mt-3 flex gap-2">
        {canRecharge && <button onClick={() => setTab("recharge")} className={`rounded-full px-4 py-2 text-xs font-bold ${tab === "recharge" ? "bg-white text-black" : "bg-white/5 text-white/60"}`}>Recharge</button>}
        {canTickets && <button onClick={() => setTab("tickets")} className={`rounded-full px-4 py-2 text-xs font-bold ${tab === "tickets" ? "bg-white text-black" : "bg-white/5 text-white/60"}`}>Tickets</button>}
        {canAudit && <button onClick={() => setTab("audit")} className={`rounded-full px-4 py-2 text-xs font-bold ${tab === "audit" ? "bg-white text-black" : "bg-white/5 text-white/60"}`}>Audit</button>}
        {canStats && <button onClick={() => setTab("stats")} className={`rounded-full px-4 py-2 text-xs font-bold ${tab === "stats" ? "bg-white text-black" : "bg-white/5 text-white/60"}`}>Stats</button>}
      </div>

      {err && <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{err}</p>}

      {tab === "recharge" && canRecharge && (
        <div className="mt-4 rounded-3xl border border-white/10 bg-[#15151d] p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><Search size={14} /> Lookup user by ID / username</h2>
          <div className="mt-2 flex gap-2">
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="user id or username" className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" />
            <button onClick={doLookup} className="rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-black">Search</button>
          </div>
          {found.length > 0 && <ul className="mt-3 space-y-1">{found.map((u) => (
            <li key={u.id} className={`flex items-center justify-between rounded-2xl px-3 py-2 text-sm ${target === u.id ? "bg-violet-500/20 text-violet-200" : "bg-white/[0.04]"}`}>
              <span>{u.display_name} <span className="text-white/40">@{u.username}</span> — <Coins size={10} className="inline" />{u.coins} <Diamond size={10} className="inline text-violet-300" />{u.gems} <Zap size={10} className="inline text-emerald-300" />{u.xp}</span>
              <button onClick={() => setTarget(u.id)} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black">Select</button>
            </li>
          ))}</ul>}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-bold text-white/50">Target user ID</span><input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="user-..." className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" /></label>
            <label className="block"><span className="text-xs font-bold text-white/50">Action</span><select value={action} onChange={(e) => setAction(e.target.value as typeof action)} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white focus:outline-none"><option value="ADD_COINS">ADD_COINS</option><option value="DEDUCT_COINS">DEDUCT_COINS</option><option value="ADD_GEMS">ADD_GEMS</option><option value="DEDUCT_GEMS">DEDUCT_GEMS</option><option value="ADD_XP">ADD_XP</option><option value="DEDUCT_XP">DEDUCT_XP</option></select></label>
            <label className="block"><span className="text-xs font-bold text-white/50">Amount</span><input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white focus:outline-none" /></label>
            <label className="block"><span className="text-xs font-bold text-white/50">Internal note</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Receipt ref" className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" /></label>
          </div>
          <button onClick={doRecharge} disabled={busy || !target} className="mt-4 w-full rounded-2xl bg-white py-3 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-50">{busy ? "Processing…" : `Execute ${action}`}</button>
          <p className="mt-2 text-xs text-white/30">Immutable audit log tracks admin_id → target_user_id. Coins = hard recharge, Gems = host earnings (70% gift cost), XP = progression.</p>
        </div>
      )}

      {tab === "tickets" && canTickets && (
        <div className="mt-4 rounded-3xl border border-white/10 bg-[#15151d] p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><Ticket size={14} /> Support tickets</h2>
          <button onClick={loadTickets} className="mt-2 rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10">Refresh</button>
          <ul className="mt-3 space-y-2">
            {tickets.length === 0 ? <p className="text-xs text-white/40">No tickets.</p> : tickets.map((t) => (
              <li key={t.id as string} className="rounded-2xl bg-white/[0.04] p-3">
                <p className="text-sm font-bold">{t.subject as string} <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">{t.status as string}</span></p>
                <p className="text-xs text-white/50">{t.category as string} — {t.message as string}</p>
                <p className="text-xs text-white/30">{t.created_at as string}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "audit" && canAudit && (
        <div className="mt-4 rounded-3xl border border-white/10 bg-[#15151d] p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><History size={14} /> Audit log (immutable)</h2>
          <button onClick={loadAudit} className="mt-2 rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10">Refresh</button>
          <ul className="mt-3 space-y-1.5">
            {audit.length === 0 ? <p className="text-xs text-white/40">No transactions yet.</p> : audit.map((a) => (
              <li key={String(a.id)} className="rounded-2xl bg-white/[0.04] px-3 py-2 text-xs">
                <span className="font-bold text-violet-200">{String(a.admin_username ?? a.admin_id)}</span> → <span className="font-bold">{String(a.target_username ?? a.target_user_id)}</span> : {String(a.action_type)} {String(a.amount)} <span className="text-white/40">{String(a.notes ?? "")}</span> <span className="float-right text-white/30">{String(a.created_at).slice(0, 19)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "stats" && canStats && (
        <div className="mt-4 rounded-3xl border border-white/10 bg-[#15151d] p-5">
          <h2 className="text-sm font-bold">Master stats & pricing</h2>
          {stats ? (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {Object.entries(stats).map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-white/[0.04] p-3"><p className="text-white/40">{k}</p><p className="text-lg font-black">{String(v)}</p></div>
              ))}
            </div>
          ) : <button onClick={loadStats} className="mt-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black">Load stats</button>}
        </div>
      )}
    </div>
  );
}
