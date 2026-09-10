"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Shield, Search, History, Ticket, Flag, DoorClosed,
  Users as UsersIcon, BarChart3, LogOut, Check,
} from "lucide-react";
import {
  adminLogin, adminMe, adminRecharge, adminTransactions, adminLookupUsers,
  adminStats, listTickets, adminFirebaseLogin, adminTeamList, adminTeamCreate,
  adminTeamRemove, listReports, resolveReport, adminEndRoom, updateTicketStatus,
  ticketDetail, replyTicket, fetchRooms,
  type AdminUser,
} from "@/lib/api";
import { auth, googleProvider, signInWithPopup } from "@/lib/firebase";
import { Field, inputCls } from "@/components/bits";

const ADMIN_TOKEN_KEY = "admin_token";

type Tab = "overview" | "users" | "rooms" | "reports" | "tickets" | "audit" | "team";

export default function AdminPage() {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    // Deferred to a task (not the effect body) so no setState runs synchronously in the effect.
    const t = setTimeout(() => {
      const saved = localStorage.getItem(ADMIN_TOKEN_KEY);
      if (!saved) return;
      setToken(saved);
      adminMe()
        .then((r) => setAdmin(r.admin))
        .catch(() => {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          setToken(null);
        });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const saveSession = (a: AdminUser, tok: string) => {
    localStorage.setItem(ADMIN_TOKEN_KEY, tok);
    setToken(tok);
    setAdmin(a);
  };
  const logout = () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken(null);
    setAdmin(null);
  };

  const passwordLogin = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await adminLogin(username.trim(), password);
      saveSession(r.admin, r.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const googleLogin = async () => {
    setBusy(true);
    setErr(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const idToken = await cred.user.getIdToken();
      const r = await adminFirebaseLogin(idToken);
      saveSession(r.admin, r.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!admin || !token) {
    return (
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-3xl border border-white/10 bg-[#15151d] p-6">
          <h1 className="flex items-center gap-2 text-xl font-black">
            <Shield size={20} className="text-violet-300" /> Game Admin
          </h1>
          <p className="mt-1 text-xs text-white/50">
            The owner signs in with Google. Team accounts use username + password.
          </p>
          <button
            onClick={() => void googleLogin()}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-bold text-black transition hover:bg-white/85 disabled:opacity-50"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4285F4] text-xs font-black text-white">G</span>
            {busy ? "Connecting…" : "Sign in with Google (Owner)"}
          </button>
          <div className="my-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/30">
            <span className="h-px flex-1 bg-white/10" /> team login <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="space-y-3">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Team username"
              autoComplete="username"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void passwordLogin();
              }}
              placeholder="Password"
              type="password"
              autoComplete="current-password"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
            {err && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{err}</p>}
            <button
              onClick={() => void passwordLogin()}
              disabled={busy || !username || !password}
              className="w-full rounded-2xl bg-white/10 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-40"
            >
              {busy ? "…" : "Sign in as team"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const role = admin.role;
  const isMaster = role === "master_admin";
  const canMoney = isMaster || role === "finance";
  const canMod = isMaster || role === "support";

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "overview", label: "Overview", show: true },
    { id: "users", label: "Users", show: canMoney || isMaster },
    { id: "rooms", label: "Rooms", show: canMod },
    { id: "reports", label: "Reports", show: canMod },
    { id: "tickets", label: "Tickets", show: canMod },
    { id: "audit", label: "Audit", show: canMoney },
    { id: "team", label: "Team", show: isMaster },
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-black">
          <Shield size={20} className="shrink-0 text-violet-300" />
          <span className="truncate">{admin.display_name}</span>
          <span className="shrink-0 rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-200">{role}</span>
        </h1>
        <button onClick={logout} className="flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10">
          <LogOut size={13} /> Exit
        </button>
      </div>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${tab === t.id ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab token={token} isMaster={isMaster} />}
      {tab === "users" && <UsersTab token={token} />}
      {tab === "rooms" && <RoomsTab token={token} />}
      {tab === "reports" && <ReportsTab token={token} />}
      {tab === "tickets" && <TicketsTab token={token} />}
      {tab === "audit" && <AuditTab token={token} />}
      {tab === "team" && isMaster && <TeamTab token={token} />}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 rounded-3xl border border-white/10 bg-[#15151d] p-5">{children}</div>;
}

function Err({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{msg}</p>;
}

function OverviewTab({ token, isMaster }: { token: string; isMaster: boolean }) {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isMaster) return;
    adminStats(token).then((s) => setStats(s.stats as Record<string, unknown>)).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [token, isMaster]);
  if (!isMaster) return <Card><p className="text-sm text-white/60">Your role dashboard. Use the tabs above for your tools.</p></Card>;
  if (!stats) return <Card>{err ? <Err msg={err} /> : <p className="text-sm text-white/50">Loading game stats…</p>}</Card>;
  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-sm font-bold"><BarChart3 size={14} /> Game at a glance</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-white/[0.04] p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{k.replace(/_/g, " ")}</p>
            <p className="text-lg font-black">{String(v)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function UsersTab({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Array<{ id: string; username: string; display_name: string; coins: number; gems: number; xp: number }>>([]);
  const [target, setTarget] = useState("");
  const [action, setAction] = useState("ADD_COINS");
  const [amount, setAmount] = useState(1000);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    setErr(null);
    try {
      const r = await adminLookupUsers(token, q.trim());
      setFound(r.users as unknown as typeof found);
      if (r.users.length === 0) setErr("No users match.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const execute = async () => {
    if (!target) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await adminRecharge(token, { target_user_id: target, action_type: action as "ADD_COINS", amount: Number(amount), notes });
      setMsg(`Done: ${action} ${amount} → ${target}. New balance: ${r.balance.coins} coins, ${r.balance.gems} gems, ${r.balance.xp} XP.`);
      setNotes("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-sm font-bold"><Search size={14} /> Find user</h2>
      <div className="mt-2 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
          placeholder="User ID or username" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" />
        <button onClick={() => void search()} className="shrink-0 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-black">Search</button>
      </div>
      {found.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {found.map((u) => (
            <li key={u.id} className={`flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-sm ${target === u.id ? "bg-violet-500/20" : "bg-white/[0.04]"}`}>
              <span className="min-w-0 truncate">{u.display_name} <span className="text-white/40">@{u.username}</span>
                <span className="block text-xs text-white/45">{u.coins} coins · {u.gems} gems · {u.xp} XP</span>
              </span>
              <button onClick={() => setTarget(u.id)} className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-black">Select</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className="text-xs font-bold text-white/50">Target user ID</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="user-..." className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-white/50">Action</span>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-[#15151d] px-3.5 py-2.5 text-sm text-white focus:outline-none">
            {["ADD_COINS", "DEDUCT_COINS", "ADD_GEMS", "DEDUCT_GEMS", "ADD_XP", "DEDUCT_XP"].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-bold text-white/50">Amount</span>
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white focus:outline-none" />
        </label>
        <label className="col-span-2 block">
          <span className="text-xs font-bold text-white/50">Internal note (receipt ref)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this adjustment?" className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" />
        </label>
      </div>
      <button onClick={() => void execute()} disabled={busy || !target} className="mt-3 w-full rounded-2xl bg-white py-3 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-40">
        {busy ? "Processing…" : `Execute ${action}`}
      </button>
      {msg && <p className="mt-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200"><Check size={12} className="mr-1 inline" />{msg}</p>}
      <Err msg={err} />
      <p className="mt-2 text-xs text-white/30">Every adjustment writes an immutable audit row (admin → user). Deductions never push coins/gems below zero.</p>
    </Card>
  );
}

function RoomsTab({ token }: { token: string }) {
  const [rooms, setRooms] = useState<Array<{ slug: string; title: string; hostName: string; listenerCount: number }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchRooms();
      setRooms(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const end = async (slug: string) => {
    if (!window.confirm(`End "${slug}" for everyone?`)) return;
    setEnding(slug);
    try {
      await adminEndRoom(token, slug);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEnding(null);
    }
  };

  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-sm font-bold"><DoorClosed size={14} /> Live rooms — end abusive rooms here</h2>
      <Err msg={err} />
      <ul className="mt-3 space-y-2">
        {rooms.length === 0 && <p className="text-xs text-white/40">No live rooms right now.</p>}
        {rooms.map((r) => (
          <li key={r.slug} className="flex items-center gap-2.5 rounded-2xl bg-white/[0.04] p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{r.title}</span>
              <span className="block text-xs text-white/45">{r.hostName} · {r.listenerCount} listening</span>
            </span>
            <button onClick={() => void end(r.slug)} disabled={ending === r.slug}
              className="shrink-0 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/20 disabled:opacity-40">
              {ending === r.slug ? "…" : "End room"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReportsTab({ token }: { token: string }) {
  const [filter, setFilter] = useState("");
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listReports(token, filter || undefined);
      setReports(r.reports as unknown as Array<Record<string, unknown>>);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [token, filter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const setStatus = async (id: string, status: "reviewing" | "resolved" | "dismissed") => {
    try {
      await resolveReport(token, id, status);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-sm font-bold"><Flag size={14} /> Safety reports</h2>
      <div className="mt-2 flex gap-2">
        {["", "open", "reviewing", "resolved", "dismissed"].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === s ? "bg-white text-black" : "bg-white/5 text-white/60"}`}>
            {s || "All"}
          </button>
        ))}
      </div>
      <Err msg={err} />
      <ul className="mt-3 space-y-2">
        {reports.length === 0 && <p className="text-xs text-white/40">No reports in this view. Clean community!</p>}
        {reports.map((r) => (
          <li key={String(r.id)} className="rounded-2xl bg-white/[0.04] p-3">
            <p className="text-sm">
              <span className="font-bold">{String(r.target_name ?? r.target_id)}</span>
              <span className="text-white/45"> reported by {String(r.reporter_name ?? r.reporter_id)}</span>
              <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">{String(r.status)}</span>
            </p>
            <p className="mt-1 text-xs text-white/60">{String(r.reason)}</p>
            <p className="text-[11px] text-white/30">{String(r.created_at)}</p>
            <div className="mt-2 flex gap-1.5">
              {(["reviewing", "resolved", "dismissed"] as const).map((s) => (
                <button key={s} onClick={() => void setStatus(String(r.id), s)}
                  className="rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-white/70 hover:bg-white/15">
                  {s}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TicketsTab({ token }: { token: string }) {
  const [tickets, setTickets] = useState<Array<Record<string, unknown>>>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ ticket: Record<string, unknown>; replies: Array<Record<string, unknown>> } | null>(null);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await listTickets({ adminToken: token });
      setTickets(t.tickets as unknown as Array<Record<string, unknown>>);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const open = async (id: string) => {
    setOpenId(id);
    setDetail(null);
    try {
      const d = await ticketDetail(id);
      setDetail({
        ticket: d.ticket as unknown as Record<string, unknown>,
        replies: d.replies as unknown as Array<Record<string, unknown>>,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const sendReply = async () => {
    if (!openId || !reply.trim()) return;
    setBusy(true);
    try {
      await replyTicket(openId, { message: reply.trim(), adminToken: token });
      await updateTicketStatus(token, openId, status as "open" | "pending" | "resolved" | "closed");
      setReply("");
      await open(openId);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-sm font-bold"><Ticket size={14} /> Support tickets</h2>
      <Err msg={err} />
      <ul className="mt-3 space-y-2">
        {tickets.length === 0 && <p className="text-xs text-white/40">No tickets.</p>}
        {tickets.map((t) => (
          <li key={String(t.id)}>
            <button onClick={() => void open(String(t.id))} className="w-full rounded-2xl bg-white/[0.04] p-3 text-left hover:bg-white/[0.07]">
              <p className="text-sm font-bold">{String(t.subject)} <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">{String(t.status)}</span></p>
              <p className="text-xs text-white/50">{String(t.category)} — {String(t.message).slice(0, 90)}</p>
            </button>
          </li>
        ))}
      </ul>
      {openId && (
        <div className="mt-3 rounded-2xl border border-white/10 p-4">
          {!detail ? (
            <p className="text-xs text-white/40">Loading conversation…</p>
          ) : (
            <>
              <p className="text-sm font-bold">{String(detail.ticket.subject)}</p>
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                {(detail.replies as Array<Record<string, unknown>>).map((r) => (
                  <p key={String(r.id)} className={`rounded-xl px-3 py-2 text-xs ${r.author_admin_id ? "ml-6 bg-violet-500/15" : "mr-6 bg-white/5"}`}>
                    {String(r.message)}
                  </p>
                ))}
                {detail.replies.length === 0 && <p className="text-xs text-white/35">No replies yet — be the first.</p>}
              </div>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={2000}
                placeholder="Write an official reply…"
                className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none" />
              <div className="mt-2 flex gap-2">
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-2xl border border-white/10 bg-[#15151d] px-3 py-2 text-xs font-bold text-white">
                  {(["pending", "resolved", "closed"] as const).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button onClick={() => void sendReply()} disabled={busy || !reply.trim()}
                  className="flex-1 rounded-2xl bg-white py-2 text-sm font-bold text-black disabled:opacity-40">
                  {busy ? "Sending…" : "Reply + set status"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function AuditTab({ token }: { token: string }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    adminTransactions(token, 50).then((a) => setRows(a.transactions)).catch(() => undefined);
  }, [token]);
  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-sm font-bold"><History size={14} /> Audit log (immutable)</h2>
      <ul className="mt-3 space-y-1.5">
        {rows.length === 0 && <p className="text-xs text-white/40">No adjustments yet.</p>}
        {rows.map((a) => (
          <li key={String(a.id)} className="rounded-2xl bg-white/[0.04] px-3 py-2 text-xs">
            <span className="font-bold text-violet-200">{String(a.admin_username ?? a.admin_id)}</span> →{" "}
            <span className="font-bold">{String(a.target_username ?? a.target_user_id)}</span> : {String(a.action_type)}{" "}
            {String(a.amount)} <span className="text-white/40">{String(a.notes ?? "")}</span>
            <span className="float-right text-white/30">{String(a.created_at).slice(0, 19)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TeamTab({ token }: { token: string }) {
  const [team, setTeam] = useState<Array<{ id: string; username: string; display_name: string; role: string; last_login: string | null }>>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"finance" | "support">("support");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await adminTeamList(token);
      setTeam(t.team);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const create = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await adminTeamCreate(token, { username: username.trim().toLowerCase(), display_name: displayName.trim(), role, password });
      setMsg(`Team account @${username.trim()} created. Share the password securely — it is stored hashed.`);
      setUsername("");
      setDisplayName("");
      setPassword("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove @${name} from the admin team? Their sessions end immediately.`)) return;
    try {
      await adminTeamRemove(token, id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-sm font-bold"><UsersIcon size={14} /> Admin team — only you manage this</h2>
      <ul className="mt-3 space-y-1.5">
        {team.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white/[0.04] px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="font-bold">{m.display_name}</span> <span className="text-white/40">@{m.username}</span>
              <span className="ml-2 rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] text-violet-200">{m.role}</span>
              <span className="block text-[11px] text-white/30">Last login: {m.last_login ?? "never"}</span>
            </span>
            {m.role !== "master_admin" && (
              <button onClick={() => void remove(m.id, m.username)} className="shrink-0 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
        <Field label="New team member">
          <div className="grid grid-cols-2 gap-2">
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" className={inputCls} />
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" className={inputCls} />
            <select value={role} onChange={(e) => setRole(e.target.value as "finance" | "support")} className={`${inputCls} bg-[#15151d]`}>
              <option value="support">support</option>
              <option value="finance">finance</option>
            </select>
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ chars)" type="password" className={inputCls} />
          </div>
        </Field>
        {msg && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200">{msg}</p>}
        <Err msg={err} />
        <button onClick={() => void create()} disabled={busy || !username || !displayName || password.length < 8}
          className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-black disabled:opacity-40">
          {busy ? "Creating…" : "Create team account"}
        </button>
      </div>
    </Card>
  );
}

