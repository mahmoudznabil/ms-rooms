"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mic, Users, Gift, Trophy } from "lucide-react";
import { useSession } from "@/stores/useSession";
import FirebaseAuthPanel from "@/components/FirebaseAuthPanel";

const PERKS = [
  { icon: Mic, text: "Live voice rooms with speaker seats" },
  { icon: Gift, text: "Animated gifts, lucky spins & PK battles" },
  { icon: Trophy, text: "Daily check-ins, XP levels & leaderboards" },
  { icon: Users, text: "Moments feed, follows & new friends" },
];

export default function LoginView() {
  const router = useRouter();
  const user = useSession((s) => s.user);

  // Already signed in (e.g. just finished Firebase auth) → go to the lobby.
  useEffect(() => {
    if (user) router.replace("/lobby");
  }, [user, router]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-violet-300">Live audio, all night</p>
        <h1 className="mt-1 text-4xl font-black tracking-tight">VibeRoom</h1>
        <p className="mt-2 text-sm text-white/55">Sign in to join the party — your progress follows you on every device.</p>
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

      <div className="mt-6">
        <FirebaseAuthPanel />
      </div>
    </div>
  );
}
