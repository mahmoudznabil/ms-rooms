"use client";

import { useState } from "react";
import { Mic, Users, Gift, Trophy } from "lucide-react";
import { AVATAR_CHOICES } from "@/lib/levels";
import { useSession } from "@/stores/useSession";
import { inputCls, PrimaryButton, Field } from "@/components/bits";
import FirebaseAuthPanel from "@/components/FirebaseAuthPanel";

const PERKS = [
  { icon: Mic, text: "Live voice rooms with 8 speaker seats" },
  { icon: Gift, text: "Animated gifts, lucky spins & PK battles" },
  { icon: Trophy, text: "Daily check-ins, XP levels & leaderboards" },
  { icon: Users, text: "Moments feed, follows & new friends" },
];

export default function LoginView() {
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState<string>(AVATAR_CHOICES[0].id);
  const [busy, setBusy] = useState(false);
  const login = useSession((s) => s.login);
  const authError = useSession((s) => s.authError);

  const submit = async () => {
    const name = username.trim();
    if (name.length < 2 || busy) return;
    setBusy(true);
    try {
      await login(name);
      // New accounts pick their look after login on the Profile page;
      // store the choice for users who set it here.
      const { patchUser } = await import("@/lib/api");
      const { user } = useSession.getState();
      if (user) {
        try {
          const updated = await patchUser(user.id, { avatar_url: avatar });
          useSession.setState({ user: updated.user });
        } catch {
          // Non-fatal: avatar can be changed later in Profile.
        }
      }
    } catch {
      // authError in the store already describes the problem.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-violet-300">Live audio, all night</p>
        <h1 className="mt-1 text-4xl font-black tracking-tight">VibeRoom</h1>
        <p className="mt-2 text-sm text-white/55">Your voice party — rooms, gifts, games & friends.</p>
      </div>

      <div className="mt-6 space-y-2 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        {PERKS.map((p) => (
          <p key={p.text} className="flex items-center gap-2.5 text-sm text-white/70">
            <span className="rounded-xl bg-violet-500/15 p-1.5 text-violet-300">
              <p.icon size={14} />
            </span>
            {p.text}
          </p>
        ))}
      </div>

      <div className="mt-6 space-y-4 rounded-3xl border border-white/10 bg-[#15151d] p-5">
        <Field label="Pick a username">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="e.g. NightOwl"
            maxLength={24}
            className={inputCls}
          />
        </Field>
        <Field label="Pick your color">
          <div className="flex gap-2">
            {AVATAR_CHOICES.map((a: (typeof AVATAR_CHOICES)[number]) => (
              <button
                key={a.id}
                title={a.label}
                aria-label={a.label}
                onClick={() => setAvatar(a.id)}
                className={`h-10 w-10 rounded-full transition active:scale-95 ${
                  avatar === a.id ? "ring-2 ring-white ring-offset-2 ring-offset-[#15151d]" : "opacity-70 hover:opacity-100"
                }`}
                style={{ background: a.css }}
              />
            ))}
          </div>
        </Field>
        {authError && (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{authError}</p>
        )}
        <PrimaryButton onClick={() => void submit()} disabled={busy || username.trim().length < 2}>
          {busy ? "Joining…" : "Join the party (guest)"}
        </PrimaryButton>
        <p className="text-center text-xs text-white/35">
          New here? An account with 100 welcome coins is created automatically.
        </p>
      </div>

      <div className="mt-6">
        <p className="mb-3 text-center text-xs font-bold uppercase tracking-widest text-white/40">Or continue with Firebase — cross-device progress</p>
        <FirebaseAuthPanel />
      </div>
    </div>
  );
}
