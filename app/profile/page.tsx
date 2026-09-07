"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, LogOut, Mic, Pencil, Sparkles, Users } from "lucide-react";
import { fetchProfile, fetchSocial, patchUser, type ProfileStats, type SocialInfo } from "@/lib/api";
import { AVATAR_CHOICES, levelProgress } from "@/lib/levels";
import { useSession } from "@/stores/useSession";
import { Field, LevelBadge, PrimaryButton, Spinner, UserAvatar, inputCls } from "@/components/bits";

export default function ProfilePage() {
  const user = useSession((s) => s.user);
  const refresh = useSession((s) => s.refresh);
  const logout = useSession((s) => s.logout);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [social, setSocial] = useState<SocialInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [p, s] = await Promise.all([fetchProfile(user.id), fetchSocial(user.id)]);
      setStats(p.stats);
      setSocial(s);
    } catch {
      // Profile shell still renders from the session.
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (user && editing && name === "" && bio === "") {
      setName(user.display_name);
      setBio(user.bio ?? "");
      setAvatar(user.avatar_url ?? AVATAR_CHOICES[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!user) return null;
  const prog = levelProgress(user.xp);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await patchUser(user.id, { display_name: name.trim(), bio: bio.trim(), avatar_url: avatar });
      await refresh();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const cards = [
    { label: "Followers", value: social?.followers ?? stats?.followers ?? 0, icon: Users },
    { label: "Following", value: social?.following ?? stats?.following ?? 0, icon: Users },
    { label: "Live rooms", value: stats?.live_rooms ?? 0, icon: Mic },
    { label: "Moments", value: stats?.moments ?? 0, icon: Sparkles },
    { label: "Gifts received", value: stats?.gifts_received ?? 0, icon: Gift },
    { label: "Gifts sent", value: stats?.gifts_sent ?? 0, icon: Gift },
  ];

  return (
    <div>
      <div className="rounded-3xl border border-white/10 bg-[#15151d] p-5">
        <div className="flex items-center gap-3.5">
          <UserAvatar name={user.display_name} avatarUrl={user.avatar_url} xp={user.xp} size={64} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-xl font-black">
              {user.display_name} <LevelBadge xp={user.xp} />
            </p>
            <p className="text-sm text-white/45">@{user.username}</p>
            {user.bio && <p className="mt-1 text-sm text-white/70">{user.bio}</p>}
          </div>
          <button
            onClick={() => {
              setError(null);
              setEditing((v) => !v);
            }}
            aria-label="Edit profile"
            className="rounded-full bg-white/5 p-2.5 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <Pencil size={15} />
          </button>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-xs font-semibold text-white/55">
            <span>Lv.{prog.level}</span>
            <span>{user.xp.toLocaleString()} / {prog.target.toLocaleString()} XP</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${prog.pct}%` }} />
          </div>
        </div>

        {editing && (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            <Field label="Display name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} className={inputCls} />
            </Field>
            <Field label="Bio">
              <input value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} placeholder="Tell the party who you are" className={inputCls} />
            </Field>
            <Field label="Avatar color">
              <div className="flex gap-2">
                {AVATAR_CHOICES.map((a: (typeof AVATAR_CHOICES)[number]) => (
                  <button key={a.id} title={a.label} aria-label={a.label} onClick={() => setAvatar(a.id)}
                    className={`h-10 w-10 rounded-full transition active:scale-95 ${avatar === a.id ? "ring-2 ring-white ring-offset-2 ring-offset-[#15151d]" : "opacity-70 hover:opacity-100"}`}
                    style={{ background: a.css }} />
                ))}
              </div>
            </Field>
            {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>}
            <PrimaryButton onClick={() => void save()} disabled={busy || name.trim().length < 2}>
              {busy ? "Saving…" : "Save profile"}
            </PrimaryButton>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <p className="flex items-center justify-center gap-1 text-lg font-black">
              <c.icon size={14} className="text-violet-300" /> {c.value.toLocaleString()}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">{c.label}</p>
          </div>
        ))}
      </div>

      {social && social.followers_list.length > 0 && (
        <>
          <h2 className="mt-5 text-sm font-bold uppercase tracking-widest text-white/50">Followers</h2>
          <ul className="mt-2 space-y-1.5">
            {social.followers_list.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 rounded-2xl bg-white/[0.04] px-3 py-2">
                <UserAvatar name={f.display_name} avatarUrl={f.avatar_url} size={30} showFrame={false} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{f.display_name}</span>
                <span className="text-xs text-white/35">@{f.username}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <button
        onClick={logout}
        className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-white/70 transition hover:bg-white/10 hover:text-white"
      >
        <LogOut size={15} /> Switch account
      </button>
      {!stats && !social && <Spinner />}
    </div>
  );
}
