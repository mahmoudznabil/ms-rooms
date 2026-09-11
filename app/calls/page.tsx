"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MessageCircle,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Video,
} from "lucide-react";
import { callRecents, type CallItem } from "@/lib/api";
import { placeCall } from "@/lib/calls";
import { useSession } from "@/stores/useSession";
import { useCalls } from "@/stores/useCalls";
import { EmptyState, Spinner, UserAvatar } from "@/components/bits";

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusIcon({ call }: { call: CallItem }) {
  if (call.status === "missed" || (call.direction === "in" && call.status === "rejected")) {
    return <PhoneMissed size={14} className="shrink-0 text-red-400" />;
  }
  if (call.direction === "in") return <PhoneIncoming size={14} className="shrink-0 text-emerald-400" />;
  return <PhoneOutgoing size={14} className="shrink-0 text-white/45" />;
}

function statusLabel(call: CallItem): string {
  switch (call.status) {
    case "missed":
      return call.direction === "in" ? "Missed" : "No answer";
    case "rejected":
      return call.direction === "in" ? "Declined" : "Declined";
    case "cancelled":
      return "Cancelled";
    case "connected":
    case "ended":
      return call.media === "video" ? "Video call" : "Voice call";
    case "ringing":
    case "initiated":
      return "Ringing…";
    default:
      return call.status;
  }
}

export default function CallsPage() {
  const user = useSession((s) => s.user);
  const clearMissedLocal = useCalls((s) => s.clearMissedLocal);
  const router = useRouter();
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "missed">("all");
  const [callingId, setCallingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { calls } = await callRecents(30);
      setCalls(calls);
    } catch {
      // List keeps last state on transient failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Opening the Calls tab clears the missed badge (standard rule).
    markSeen();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const markSeen = async () => {
    clearMissedLocal();
    try {
      const { markCallsSeen } = await import("@/lib/api");
      await markCallsSeen();
    } catch {
      // Best-effort.
    }
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  const callBack = async (peerId: string, peerName: string) => {
    if (!user || callingId) return;
    setCallingId(peerId);
    const err = await placeCall(peerId, user.id, "audio", router);
    setCallingId(null);
    if (err) setNotice(`${peerName}: ${err}`);
    else void load();
  };

  const filtered = tab === "missed" ? calls.filter((c) => c.status === "missed" && c.direction === "in") : calls;
  const missedCount = calls.filter((c) => c.status === "missed" && c.direction === "in").length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Calls</h1>
          <p className="mt-0.5 text-xs text-white/50">Voice &amp; video — recents sync across devices.</p>
        </div>
        <Link href="/search" className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-white/85">
          <Phone size={15} /> New call
        </Link>
      </div>

      {notice && <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-semibold text-amber-200">{notice}</p>}

      <div className="mt-4 flex gap-2" role="tablist" aria-label="Call history filter">
        {(["all", "missed"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            {t === "all" ? "All" : `Missed${missedCount > 0 ? ` (${missedCount})` : ""}`}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={tab === "missed" ? "No missed calls" : "No calls yet"}
            hint={tab === "missed" ? "Declined and unanswered calls show up here." : "Search for a friend and tap Call — voice or video."}
          />
          <Link href="/search" className="mt-3 block rounded-2xl bg-white py-3 text-center text-sm font-bold text-black transition hover:bg-white/85">
            Find someone to call
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {filtered.map((c) => (
            <li key={c.id} className="rounded-2xl border border-white/10 bg-[#15151d] p-3">
              <div className="flex items-center gap-2.5">
                <Link href={`/profile?u=${encodeURIComponent(c.peer.username)}`} aria-label={`View ${c.peer.display_name}`}>
                  <UserAvatar name={c.peer.display_name} avatarUrl={c.peer.avatar_url} size={44} />
                </Link>
                <span className="min-w-0 flex-1">
                  <Link href={`/profile?u=${encodeURIComponent(c.peer.username)}`} className="block truncate text-sm font-extrabold hover:underline">
                    {c.peer.display_name}
                  </Link>
                  <span className="flex items-center gap-1 text-xs text-white/45">
                    <StatusIcon call={c} />
                    {statusLabel(c)} · {timeAgo(c.created_at)}
                    {c.media === "video" && <Video size={11} className="ml-0.5 text-white/35" />}
                  </span>
                </span>
                <Link
                  href={`/messages?userId=${encodeURIComponent(c.peer.id)}`}
                  aria-label={`Message ${c.peer.display_name}`}
                  className="rounded-full bg-white/5 p-2.5 text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  <MessageCircle size={16} />
                </Link>
                <button
                  onClick={() => void callBack(c.peer.id, c.peer.display_name)}
                  disabled={callingId === c.peer.id}
                  aria-label={`Call ${c.peer.display_name} back`}
                  className="rounded-full bg-emerald-500/20 p-2.5 text-emerald-300 transition hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  <Phone size={16} />
                </button>
              </div>
              {(c.status === "ringing" || c.status === "initiated") && (
                <Link
                  href={`/call?room=${encodeURIComponent(c.room_slug)}`}
                  className="mt-2 block rounded-xl bg-emerald-500/15 py-2 text-center text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/25"
                >
                  {c.direction === "in" ? "Answer now" : "Return to ringing call"}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
