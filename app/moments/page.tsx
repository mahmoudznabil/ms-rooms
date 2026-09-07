"use client";

import { useCallback, useEffect, useState } from "react";
import { Heart, Send, Sparkles } from "lucide-react";
import { fetchMoments, likeMoment, postMoment, unlikeMoment, type MomentItem } from "@/lib/api";
import { useSession } from "@/stores/useSession";
import { EmptyState, Spinner, UserAvatar } from "@/components/bits";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(ms) || ms < 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function MomentsPage() {
  const user = useSession((s) => s.user);
  const refresh = useSession((s) => s.refresh);
  const [items, setItems] = useState<MomentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const f = await fetchMoments(user.id, 30);
      setItems(f.moments);
    } catch {
      // keep last feed
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!user) return null;

  const post = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    try {
      await postMoment(user.id, text);
      setDraft("");
      await load();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post. Try again.");
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (m: MomentItem) => {
    const liked = !!m.liked;
    setItems((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, liked: !liked, likes: x.likes + (liked ? -1 : 1) } : x))
    );
    try {
      if (liked) await unlikeMoment(m.id, user.id);
      else await likeMoment(m.id, user.id);
    } catch {
      await load();
    }
  };

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
        <Sparkles size={22} className="text-fuchsia-300" /> Moments
      </h1>
      <p className="mt-0.5 text-sm text-white/50">Share ideas and hobbies — posting earns 5 XP.</p>

      <div className="mt-4 rounded-3xl border border-white/10 bg-[#15151d] p-4">
        <div className="flex gap-2.5">
          <UserAvatar name={user.display_name} avatarUrl={user.avatar_url} xp={user.xp} size={38} />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What's on your mind?"
            maxLength={280}
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none"
          />
        </div>
        {error && <p className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-white/35">{draft.length}/280</span>
          <button
            onClick={() => void post()}
            disabled={posting || draft.trim().length === 0}
            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/85 disabled:opacity-40"
          >
            <Send size={14} /> {posting ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No moments yet" hint="Be the first to share something with the community." />
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((m) => (
            <li key={m.id} className="rounded-3xl border border-white/10 bg-[#15151d] p-4">
              <div className="flex items-center gap-2.5">
                <UserAvatar name={m.display_name} avatarUrl={m.avatar_url} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-extrabold">
                    {m.display_name}
                    <span className="truncate text-xs font-normal text-white/40">· {timeAgo(m.created_at)}</span>
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white/85">{m.text}</p>
              <button
                onClick={() => void toggleLike(m)}
                aria-label={m.liked ? "Unlike" : "Like"}
                className={`mt-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition active:scale-95 ${
                  m.liked ? "bg-rose-500/20 text-rose-300" : "bg-white/5 text-white/50 hover:bg-white/10"
                }`}
              >
                <Heart size={13} fill={m.liked ? "currentColor" : "none"} />
                {m.likes} {m.likes === 1 ? "like" : "likes"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
