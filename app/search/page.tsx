"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic, Search, UserCheck, UserPlus, Users, MessageCircle, Phone, Eye, Video } from "lucide-react";
import { follow, searchAll, unfollow, type ApiRoomRow, type ApiUser } from "@/lib/api";
import { placeCall } from "@/lib/calls";
import { useSession } from "@/stores/useSession";
import { EmptyState, UserAvatar } from "@/components/bits";
import { formatCount } from "@/lib/rooms";

export default function SearchPage() {
  const user = useSession((s) => s.user);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rooms, setRooms] = useState<ApiRoomRow[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRooms([]);
      setUsers([]);
      setSearched(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      searchAll(q.trim())
        .then((r) => {
          setRooms(r.rooms);
          setUsers(r.users.filter((u) => u.id !== user?.id));
          setSearched(true);
        })
        .catch(() => undefined)
        .finally(() => setBusy(false));
    }, 400);
    return () => clearTimeout(t);
  }, [q, user?.id]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(t);
  }, [notice]);

  const toggleFollow = async (id: string) => {
    if (!user) return;
    const isFollowing = following[id] ?? false;
    setFollowing((f) => ({ ...f, [id]: !isFollowing }));
    try {
      if (isFollowing) await unfollow(user.id, id);
      else await follow(user.id, id);
    } catch (e) {
      setFollowing((f) => ({ ...f, [id]: isFollowing }));
      setNotice(e instanceof Error ? e.message : "Follow failed.");
    }
  };

  const startCall = async (peerId: string, peerName: string, media: "audio" | "video") => {
    if (!user || callingId) return;
    setCallingId(`${peerId}:${media}`);
    const err = await placeCall(peerId, user.id, media, router);
    setCallingId(null);
    if (err) setNotice(`${peerName}: ${err}`);
  };

  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight">Discover</h1>
      <div className="relative mt-3">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search rooms or people… or unique ID (e.g. MAYA#1842)"
          aria-label="Search rooms or people"
          maxLength={40}
          autoFocus
          className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none"
        />
      </div>
      {notice && <p className="mt-2 rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-semibold text-amber-200">{notice}</p>}

      {q.trim().length >= 2 && (
        <div className="mt-4 space-y-5">
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">Rooms</h2>
            {busy && rooms.length === 0 ? (
              <p className="mt-2 text-sm text-white/40">Searching…</p>
            ) : rooms.length === 0 && searched ? (
              <div className="mt-2"><EmptyState title="No rooms found" /></div>
            ) : (
              <ul className="mt-2 space-y-2">
                {rooms.map((r) => (
                  <li key={r.id}>
                    <Link prefetch={false} href={`/room?slug=${r.slug}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#15151d] p-3 transition hover:border-violet-400/40">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: r.cover_color }}>
                        <Mic size={18} className="text-white/85" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-extrabold">{r.title}</span>
                        <span className="flex items-center gap-1 text-xs text-white/45">
                          <Users size={11} /> {formatCount(r.listener_count)} · {r.host_name}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">People</h2>
            {users.length === 0 && searched && !busy ? (
              <div className="mt-2"><EmptyState title="No people found" /></div>
            ) : (
              <ul className="mt-2 space-y-2">
                {users.map((u) => (
                  <li key={u.id} className="rounded-2xl border border-white/10 bg-[#15151d] p-3">
                    <div className="flex items-center gap-2.5">
                      <Link prefetch={false} href={`/profile?u=${encodeURIComponent(u.username)}`} aria-label={`View ${u.display_name}`}>
                        <UserAvatar name={u.display_name} avatarUrl={u.avatar_url} xp={u.xp} size={40} />
                      </Link>
                      <span className="min-w-0 flex-1">
                        <Link prefetch={false} href={`/profile?u=${encodeURIComponent(u.username)}`} className="block truncate text-sm font-extrabold hover:underline">
                          {u.display_name}{" "}
                          {u.id_tag && <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs font-bold text-white/60">{u.id_tag}</span>}
                        </Link>
                        <span className="block truncate text-xs text-white/40">@{u.username}</span>
                      </span>
                      <button
                        onClick={() => void toggleFollow(u.id)}
                        className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                          following[u.id] ? "bg-white/10 text-white/70" : "bg-white text-black"
                        }`}
                      >
                        {following[u.id] ? <UserCheck size={13} /> : <UserPlus size={13} />}
                        {following[u.id] ? "Following" : "Follow"}
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Link prefetch={false}
                        href={`/profile?u=${encodeURIComponent(u.username)}`}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-white/5 py-2 text-xs font-bold text-white/75 transition hover:bg-white/10 hover:text-white"
                      >
                        <Eye size={13} /> View profile
                      </Link>
                      <Link prefetch={false}
                        href={`/messages?userId=${encodeURIComponent(u.id)}`}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-white/5 py-2 text-xs font-bold text-white/75 transition hover:bg-white/10 hover:text-white"
                      >
                        <MessageCircle size={13} /> Message
                      </Link>
                      <button
                        onClick={() => void startCall(u.id, u.display_name, "audio")}
                        disabled={callingId === `${u.id}:audio`}
                        aria-label={`Voice call ${u.display_name}`}
                        title="Voice call"
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-violet-500/20 py-2 text-xs font-bold text-violet-200 transition hover:bg-violet-500/30 disabled:opacity-40"
                      >
                        <Phone size={13} /> {callingId === `${u.id}:audio` ? "Calling…" : "Call"}
                      </button>
                      <button
                        onClick={() => void startCall(u.id, u.display_name, "video")}
                        disabled={callingId === `${u.id}:video`}
                        aria-label={`Video call ${u.display_name}`}
                        title="Video call"
                        className="flex items-center justify-center rounded-xl bg-violet-500/20 px-3 py-2 text-violet-200 transition hover:bg-violet-500/30 disabled:opacity-40"
                      >
                        <Video size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {q.trim().length < 2 && (
        <div className="mt-4"><EmptyState title="Find your vibe" hint="Type at least 2 characters to search rooms and people." /></div>
      )}
    </div>
  );
}
