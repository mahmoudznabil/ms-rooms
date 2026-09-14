"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/stores/useSession";
import FirebaseAuthPanel from "@/components/FirebaseAuthPanel";

// GitHub-style auth page: narrow centered column, logo on top, the panel
// brings its own heading + cards. Signed-in users bounce to the lobby.
export default function LoginView() {
  const router = useRouter();
  const user = useSession((s) => s.user);

  useEffect(() => {
    if (user) router.replace("/lobby");
  }, [user, router]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[340px] flex-col px-4 py-10">
      <div className="flex justify-center pt-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-12 w-12 rounded-xl object-contain ring-1 ring-white/10" />
      </div>

      <FirebaseAuthPanel />

      <div className="mt-8 flex items-center justify-center gap-4 text-xs text-white/35">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="hover:text-white/60 hover:underline">Home</a>
        <a href="/support" className="hover:text-white/60 hover:underline">Support</a>
      </div>
      <p className="mt-4 text-center text-[11px] leading-relaxed text-white/20">
        Your coins, gems and rooms follow you on every device.
      </p>
    </div>
  );
}
