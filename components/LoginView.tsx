"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/stores/useSession";
import FirebaseAuthPanel from "@/components/FirebaseAuthPanel";

export default function LoginView() {
  const router = useRouter();
  const user = useSession((s) => s.user);

  useEffect(() => {
    if (user) router.replace("/lobby");
  }, [user, router]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white text-sm font-black text-black">V</div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">Sign in to VibeRoom</h1>
        <p className="mt-1.5 text-sm text-white/40">Your coins, gems and rooms follow you — phone, email or Google.</p>
      </div>

      <div className="mt-8">
        <FirebaseAuthPanel />
      </div>

      <p className="mt-6 text-center text-xs text-white/20">
        By continuing you agree to our Terms and Privacy. Progress stored in D1 by <code className="rounded bg-white/10 px-1">firebase_uid</code>.
      </p>
    </div>
  );
}
