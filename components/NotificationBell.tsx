"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Coins, MessageCircle, Mic, Sparkles } from "lucide-react";
import {
  fetchNotifications,
  markNotificationsRead,
  notificationUnreadCount,
  type AppNotification,
} from "@/lib/api";
import { useSession } from "@/stores/useSession";

function iconFor(type: AppNotification["type"]) {
  if (type === "checkin") return <Coins size={15} className="text-amber-300" />;
  if (type === "room_live") return <Mic size={15} className="text-emerald-300" />;
  if (type === "message") return <MessageCircle size={15} className="text-sky-300" />;
  return <Sparkles size={15} className="text-violet-300" />;
}

/**
 * In-app notification bell: daily check-in reminders, followed hosts going
 * live, and new DMs. Polls the unread count on a visibility-aware 30s rhythm
 * (matching the room/chat loops) and loads the list only when opened.
 */
export default function NotificationBell() {
  const user = useSession((s) => s.user);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refreshUnread = useCallback(async () => {
    try {
      const r = await notificationUnreadCount();
      setUnread(r.unread);
    } catch {
      // Badge stays put on transient failures.
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      setOpen(false);
      return;
    }
    void refreshUnread();
    const t = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) void refreshUnread();
    }, 30000);
    return () => clearInterval(t);
  }, [user, refreshUnread]);

  // Close on outside tap / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        const r = await fetchNotifications(20);
        setItems(r.notifications);
      } catch {
        // Panel shows the empty state below.
      } finally {
        setLoading(false);
      }
    }
  };

  const markAll = async () => {
    try {
      await markNotificationsRead("all");
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? "now" })));
      setUnread(0);
    } catch {}
  };

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read_at) {
      setUnread((u) => Math.max(0, u - 1));
      try {
        await markNotificationsRead([n.id]);
      } catch {}
    }
  };

  if (!user) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => void toggle()}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative grid h-11 w-11 place-items-center rounded-full bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 max-h-[70dvh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-white/10 bg-[#17171f] p-3 shadow-2xl"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-sm font-extrabold">Notifications</p>
            {unread > 0 && (
              <button onClick={() => void markAll()} className="min-h-[44px] px-2 text-xs font-bold text-violet-300 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {loading ? (
            <p className="px-1 py-6 text-center text-xs text-white/40">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-white/40">All caught up. Rooms you follow and new messages show up here.</p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    prefetch={false}
                    href={n.link || "/lobby"}
                    onClick={() => void openItem(n)}
                    className={`flex gap-2.5 rounded-2xl p-3 transition hover:bg-white/[0.07] ${n.read_at ? "opacity-60" : "bg-white/[0.04]"}`}
                  >
                    <span className="mt-0.5 shrink-0">{iconFor(n.type)}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">{n.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-white/55">{n.body}</span>
                    </span>
                    {!n.read_at && <span className="ml-auto mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-400" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
