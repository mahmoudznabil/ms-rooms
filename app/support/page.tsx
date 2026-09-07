"use client";

import { useState, useEffect } from "react";
import { createTicket, listTickets } from "@/lib/api";
import { useSession } from "@/stores/useSession";

export default function SupportPage() {
  const user = useSession((s) => s.user);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<"recharge" | "account" | "technical" | "moderation" | "other">("recharge");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Array<Record<string, unknown>>>([]);

  const load = async () => {
    if (!user) return;
    const r = await listTickets({ user_id: user.id });
    setTickets(r.tickets as unknown as typeof tickets);
  };
  useEffect(() => { if (user) void load(); }, [user]);

  if (!user) return null;

  const submit = async () => {
    if (!subject.trim() || !message.trim()) return;
    setBusy(true);
    try {
      await createTicket({ user_id: user.id, subject: subject.trim(), category, message: message.trim() });
      setSubject(""); setMessage(""); setNotice("Ticket submitted — support will reply soon. Check balances via lookup link in ticket.");
      void load();
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight">Support Desk</h1>
      <p className="text-xs text-white/50">Recharge issues, blocked accounts, technical — quick replies + transaction lookup embedded.</p>

      <div className="mt-4 rounded-3xl border border-white/10 bg-[#15151d] p-5">
        <h2 className="text-sm font-bold">New ticket</h2>
        <div className="mt-3 space-y-3">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (e.g. Missing 27,500 coins)" maxLength={80} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" />
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white focus:outline-none">
            <option value="recharge">Missing recharge</option>
            <option value="account">Blocked account</option>
            <option value="technical">Technical</option>
            <option value="moderation">Moderation</option>
            <option value="other">Other</option>
          </select>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe payment receipt, user ID, and what you expected." maxLength={2000} rows={4} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none" />
          {notice && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200">{notice}</p>}
          <button onClick={submit} disabled={busy || !subject.trim() || !message.trim()} className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-50">{busy ? "…" : "Submit ticket"}</button>
        </div>
      </div>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-widest text-white/50">My tickets</h2>
      <ul className="mt-2 space-y-2">
        {tickets.length === 0 ? <p className="text-xs text-white/40">No tickets yet.</p> : tickets.map((t) => (
          <li key={String(t.id)} className="rounded-2xl bg-white/[0.04] p-3">
            <p className="text-sm font-bold">{String(t.subject)} <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">{String(t.status)}</span></p>
            <p className="text-xs text-white/50">{String(t.category)} — {String(t.message).slice(0, 120)}</p>
            <p className="text-xs text-white/30">{String(t.created_at)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
