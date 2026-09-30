"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, Gift, LogOut, MessageCircle, Mic, Pencil, Phone, Sparkles, Trophy, UserCheck, UserPlus, Users, Trash2, AlertTriangle, Link2, ImagePlus, Video } from "lucide-react";
import { checkUsername, fetchProfile, fetchSocial, follow, unfollow, patchUser, type ApiUser, type ProfileStats, type SocialInfo } from "@/lib/api";
import { placeCall } from "@/lib/calls";
import { AVATAR_CHOICES, levelProgress } from "@/lib/levels";
import { useSession } from "@/stores/useSession";
import { Field, LevelBadge, PrimaryButton, Spinner, UserAvatar, inputCls } from "@/components/bits";

function OwnProfile() {
  const user = useSession((s) => s.user);
  const refresh = useSession((s) => s.refresh);
  const logout = useSession((s) => s.logout);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [social, setSocial] = useState<SocialInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameState, setUsernameState] = useState<{ kind: "idle" | "checking" | "ok" | "bad"; msg: string }>({ kind: "idle", msg: "" });
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

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
      setUsername(user.username);
      setUsernameState({ kind: "idle", msg: "" });
      setBio(user.bio ?? "");
      setAvatar(user.avatar_url ?? AVATAR_CHOICES[0].id);
      setAvatarUrlInput(
        user.avatar_url && (user.avatar_url.startsWith("http://") || user.avatar_url.startsWith("https://"))
          ? user.avatar_url
          : ""
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Live username availability (FB/IG-style rename).
  useEffect(() => {
    if (!editing || !user) return;
    const v = username.trim();
    if (v === user.username) {
      setUsernameState({ kind: "idle", msg: "" });
      return;
    }
    if (!/^[A-Za-z0-9_.-]{2,24}$/.test(v)) {
      setUsernameState({ kind: "bad", msg: "2-24 chars: letters, numbers, _ . - (no spaces)." });
      return;
    }
    setUsernameState({ kind: "checking", msg: "Checking…" });
    const t = setTimeout(() => {
      checkUsername(v, user.id)
        .then((r) => {
          if (r.available) setUsernameState({ kind: "ok", msg: `@${v} is available` });
          else setUsernameState({ kind: "bad", msg: r.reason || "That username is taken." });
        })
        .catch(() => setUsernameState({ kind: "idle", msg: "" }));
    }, 450);
    return () => clearTimeout(t);
  }, [username, editing, user]);

  // Client-side photo prep: square-cover resize to 256px JPEG data URL (no storage keys needed).
  const onPhotoFile = async (file: File | undefined) => {
    if (!file || photoBusy) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setPhotoBusy(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const S = 256;
            const canvas = document.createElement("canvas");
            canvas.width = S;
            canvas.height = S;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas unavailable");
            const scale = Math.max(S / img.width, S / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
            URL.revokeObjectURL(url);
            let q = 0.85;
            let out = canvas.toDataURL("image/jpeg", q);
            while (out.length > 140000 && q > 0.4) {
              q -= 0.15;
              out = canvas.toDataURL("image/jpeg", q);
            }
            resolve(out);
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Could not read that image."));
        };
        img.src = url;
      });
      if (dataUrl.length > 150000) {
        setError("That photo is too large even after resize — try a smaller one.");
        return;
      }
      setAvatar(dataUrl);
      setAvatarUrlInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not process that photo.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteAccount = async () => {
    setDeleteBusy(true);
    try {
      const res = await fetch("/api/users/me/delete", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to delete account");
      // Redirect to home after successful deletion
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete account");
    } finally {
      setDeleteBusy(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!user) return null;
  const prog = levelProgress(user.xp);

  const save = async () => {
    if (busy || !user) return;
    const cleanUsername = username.trim();
    if (cleanUsername !== user.username && usernameState.kind !== "ok") {
      setError(
        usernameState.kind === "bad"
          ? usernameState.msg
          : "Wait for the username check to finish, or keep your current name."
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchUser(user.id, {
        display_name: name.trim(),
        bio: bio.trim(),
        avatar_url: avatar,
        ...(cleanUsername !== user.username ? { username: cleanUsername } : {}),
      });
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
            {/* FB/IG-style photo: tap to upload, paste a link, or pick a color */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Change profile photo"
                className="relative shrink-0 transition active:scale-95"
              >
                <UserAvatar name={name || user.display_name} avatarUrl={avatar} xp={user.xp} size={64} />
                <span className="absolute -bottom-1 -right-1 rounded-full bg-white p-1.5 text-black shadow">
                  <Camera size={14} />
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Profile photo</p>
                <p className="text-xs text-white/45">Tap the photo to upload — like FB &amp; IG.</p>
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={photoBusy}
                    className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-40"
                  >
                    <ImagePlus size={13} /> {photoBusy ? "Working…" : "Upload"}
                  </button>
                  {(avatar.startsWith("data:image/") || avatar.startsWith("http")) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAvatar(AVATAR_CHOICES[0].id);
                        setAvatarUrlInput("");
                      }}
                      className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:bg-white/15"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Upload profile photo"
                onChange={(e) => void onPhotoFile(e.target.files?.[0])}
              />
            </div>
            <Field label="Photo link (optional)">
              <div className="flex gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Link2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    value={avatarUrlInput}
                    onChange={(e) => setAvatarUrlInput(e.target.value)}
                    onBlur={() => {
                      const v = avatarUrlInput.trim();
                      if (v && (v.startsWith("http://") || v.startsWith("https://"))) setAvatar(v);
                    }}
                    placeholder="https://…"
                    inputMode="url"
                    className={`${inputCls} pl-9`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const v = avatarUrlInput.trim();
                    if (v && (v.startsWith("http://") || v.startsWith("https://"))) setAvatar(v);
                    else setError("Paste an http(s) image link first.");
                  }}
                  className="shrink-0 rounded-2xl bg-white/10 px-3.5 text-xs font-bold text-white transition hover:bg-white/15"
                >
                  Use link
                </button>
              </div>
            </Field>
            <Field label="Username (unique, like IG)">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                maxLength={24}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="yourname"
                className={inputCls}
              />
              {username.trim() !== user.username && usernameState.msg && (
                <p
                  className={`mt-1 text-xs font-semibold ${
                    usernameState.kind === "ok"
                      ? "text-emerald-300"
                      : usernameState.kind === "bad"
                        ? "text-red-300"
                        : "text-white/40"
                  }`}
                >
                  {usernameState.kind === "checking" ? "Checking…" : usernameState.msg}
                </p>
              )}
              {username.trim() === user.username && (
                <p className="mt-1 text-xs text-white/35">This is your current handle. Share your profile: /profile?u={user.username}</p>
              )}
            </Field>
            <Field label="Display name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} className={inputCls} />
            </Field>
            <Field label="Bio">
              <input value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} placeholder="Tell the party who you are" className={inputCls} />
            </Field>
            <Field label="Avatar color (used when no photo)">
              <div className="flex gap-2">
                {AVATAR_CHOICES.map((a: (typeof AVATAR_CHOICES)[number]) => (
                  <button key={a.id} title={a.label} aria-label={a.label} onClick={() => setAvatar(a.id)}
                    className={`h-10 w-10 rounded-full transition active:scale-95 ${avatar === a.id ? "ring-2 ring-white ring-offset-2 ring-offset-[#15151d]" : "opacity-70 hover:opacity-100"}`}
                    style={{ background: a.css }} />
                ))}
              </div>
            </Field>
            {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>}
            <PrimaryButton onClick={() => void save()} disabled={busy || name.trim().length < 2 || usernameState.kind === "bad" || usernameState.kind === "checking"}>
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

      <Link prefetch={false} href="/rankings" className="mt-3 flex items-center justify-center gap-1.5 rounded-2xl border border-amber-300/20 bg-amber-300/10 py-3 text-sm font-bold text-amber-200 transition hover:bg-amber-300/20">
        <Trophy size={15} /> Leaderboards
      </Link>

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
      <button
        onClick={() => setShowDeleteConfirm(true)}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-red-400/30 bg-red-500/10 py-3 text-sm font-bold text-red-300 transition hover:bg-red-500/20"
      >
        <Trash2 size={15} /> Delete account
      </button>
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="modal-pop w-full max-w-sm rounded-3xl border border-white/10 bg-[#17171f] p-6 text-center shadow-2xl">
            <div className="flex justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <AlertTriangle size={16} />
              </button>
            </div>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 text-red-300">
              <Trash2 size={28} />
            </div>
            <h2 className="text-lg font-bold text-white">Delete your account?</h2>
            <p className="mt-1 text-sm text-white/60">
              This will permanently delete your account and all data. This action cannot be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
              >
                Cancel
              </button>
              <button
                onClick={deleteAccount}
                disabled={deleteBusy}
                className="flex-1 rounded-2xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-400 disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "Yes, delete my account"}
              </button>
            </div>
          </div>
        </div>
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

function FriendProfile({ userKey }: { userKey: string }) {
  const router = useRouter();
  const currentUser = useSession((s) => s.user);
  const [profileUser, setProfileUser] = useState<ApiUser | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [social, setSocial] = useState<SocialInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [following, setFollowing] = useState(false);
  const [busyFollow, setBusyFollow] = useState(false);
  const [calling, setCalling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const [p, s] = await Promise.all([
          fetchProfile(userKey),
          fetchSocial(userKey, currentUser?.id),
        ]);
        if (cancelled) return;
        setProfileUser(p.user);
        setStats(p.stats);
        setSocial(s);
        setFollowing(s.followed_by_viewer);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userKey, currentUser?.id]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  if (loading) return <Spinner />;

  if (notFound || !profileUser) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">👻</p>
        <h1 className="mt-3 text-xl font-black">User not found</h1>
        <p className="mt-1 text-sm text-white/50">No one matches “{userKey}”. Check the spelling or search again.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link prefetch={false} href="/search" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Search again</Link>
          <Link prefetch={false} href="/lobby" className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">Back to lobby</Link>
        </div>
      </div>
    );
  }

  const isOwn = currentUser?.id === profileUser.id;
  const prog = levelProgress(profileUser.xp);

  const toggleFollow = async () => {
    if (!currentUser || busyFollow) return;
    setBusyFollow(true);
    try {
      if (following) {
        await unfollow(currentUser.id, profileUser.id);
        setFollowing(false);
      } else {
        await follow(currentUser.id, profileUser.id);
        setFollowing(true);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Follow failed. Try again.");
    } finally {
      setBusyFollow(false);
    }
  };

  const startCall = async (media: "audio" | "video") => {
    if (!currentUser || calling) return;
    setCalling(true);
    const err = await placeCall(profileUser.id, currentUser.id, media, router);
    if (err) setNotice(err);
    setCalling(false);
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
      {notice && <p className="mb-3 rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-semibold text-amber-200">{notice}</p>}
      <div className="rounded-3xl border border-white/10 bg-[#15151d] p-5">
        <div className="flex items-center gap-3.5">
          <UserAvatar name={profileUser.display_name} avatarUrl={profileUser.avatar_url} xp={profileUser.xp} size={64} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-xl font-black">
              {profileUser.display_name} <LevelBadge xp={profileUser.xp} />
            </p>
            <p className="text-sm text-white/45">@{profileUser.username}</p>
            {profileUser.bio && <p className="mt-1 text-sm text-white/70">{profileUser.bio}</p>}
          </div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-xs font-semibold text-white/55">
            <span>Lv.{prog.level}</span>
            <span>{profileUser.xp.toLocaleString()} / {prog.target.toLocaleString()} XP</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${prog.pct}%` }} />
          </div>
        </div>

        {isOwn ? (
          <Link prefetch={false} href="/profile" className="mt-4 block rounded-2xl bg-white py-3 text-center text-sm font-bold text-black transition hover:bg-white/85">
            This is you — open your profile
          </Link>
        ) : (
          <div className="mt-4 grid grid-cols-4 gap-2">
            <button
              onClick={() => void toggleFollow()}
              disabled={busyFollow}
              className={`flex items-center justify-center gap-1 rounded-2xl py-3 text-sm font-bold transition disabled:opacity-40 ${following ? "bg-white/10 text-white/70 hover:bg-white/15" : "bg-white text-black hover:bg-white/85"}`}
            >
              {following ? <UserCheck size={15} /> : <UserPlus size={15} />} {following ? "Following" : "Follow"}
            </button>
            <Link prefetch={false}
              href={`/messages?userId=${encodeURIComponent(profileUser.id)}`}
              className="flex items-center justify-center gap-1 rounded-2xl bg-white/10 py-3 text-sm font-bold text-white transition hover:bg-white/15"
            >
              <MessageCircle size={15} /> Message
            </Link>
            <button
              onClick={() => void startCall("audio")}
              disabled={calling}
              className="flex items-center justify-center gap-1 rounded-2xl bg-violet-500/25 py-3 text-sm font-bold text-violet-100 transition hover:bg-violet-500/35 disabled:opacity-40"
            >
              <Phone size={15} /> {calling ? "Calling…" : "Call"}
            </button>
            <button
              onClick={() => void startCall("video")}
              disabled={calling}
              aria-label="Video call"
              title="Video call"
              className="flex items-center justify-center rounded-2xl bg-violet-500/25 py-3 text-sm font-bold text-violet-100 transition hover:bg-violet-500/35 disabled:opacity-40"
            >
              <Video size={15} />
            </button>
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
              <li key={f.id}>
                <Link prefetch={false} href={`/profile?u=${encodeURIComponent(f.username)}`} className="flex items-center gap-2.5 rounded-2xl bg-white/[0.04] px-3 py-2 transition hover:bg-white/[0.08]">
                  <UserAvatar name={f.display_name} avatarUrl={f.avatar_url} size={30} showFrame={false} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{f.display_name}</span>
                  <span className="text-xs text-white/35">@{f.username}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ProfileRouter() {
  const params = useSearchParams();
  const user = useSession((s) => s.user);
  const u = (params.get("u") ?? "").trim();
  if (u && (!user || u.toLowerCase() !== user.username.toLowerCase())) {
    return <FriendProfile userKey={u} />;
  }
  return <OwnProfile />;
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ProfileRouter />
    </Suspense>
  );
}
