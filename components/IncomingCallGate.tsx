"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Phone, PhoneOff, Video } from "lucide-react";
import { incomingCalls, rejectCallRoom, type IncomingCall } from "@/lib/api";
import { useSession } from "@/stores/useSession";
import { useCalls } from "@/stores/useCalls";
import { UserAvatar } from "@/components/bits";
import { startRingtone, stopRingtone } from "@/lib/ringtone";

/**
 * App-wide incoming-call listener (standard rule: ringing must reach the user
 * wherever they are in the app, not only inside a room). Polls the ringing
 * sessions where I'm the callee and renders a full-screen incoming UI with
 * Accept / Decline + ringtone. Hidden while already on that call's screen.
 */
export default function IncomingCallGate() {
  const user = useSession((s) => s.user);
  const refreshMissed = useCalls((s) => s.refreshMissed);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [ringing, setRinging] = useState<IncomingCall | null>(null);
  const [busy, setBusy] = useState(false);
  const ringingRef = useRef<IncomingCall | null>(null);
  ringingRef.current = ringing;

  const onCallScreenFor = useCallback(
    (roomSlug: string) => pathname === "/call" && searchParams.get("room") === roomSlug,
    [pathname, searchParams]
  );

  useEffect(() => {
    if (!user) {
      setRinging(null);
      stopRingtone();
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const { incoming } = await incomingCalls();
        if (cancelled) return;
        const first = incoming[0] ?? null;
        const prev = ringingRef.current;
        if (first && !onCallScreenFor(first.room_slug)) {
          if (prev?.id !== first.id) {
            setRinging(first);
            startRingtone();
          }
        } else {
          // Ringing stopped remotely (cancelled/expired) while we showed it.
          if (prev && !first) {
            setRinging(null);
            stopRingtone();
            void refreshMissed();
          } else if (first && onCallScreenFor(first.room_slug)) {
            setRinging(null);
            stopRingtone();
          }
        }
      } catch {
        // Silent — last state stays, next poll retries.
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user, onCallScreenFor, refreshMissed]);

  useEffect(() => stopRingtone, []);

  if (!user || !ringing) return null;

  const accept = () => {
    if (busy) return;
    stopRingtone();
    setRinging(null);
    router.push(`/call?room=${encodeURIComponent(ringing.room_slug)}`);
  };

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    stopRingtone();
    try {
      await rejectCallRoom(ringing.room_id);
    } catch {
      // Best-effort: the session expires to missed on its own.
    } finally {
      setRinging(null);
      setBusy(false);
      void refreshMissed();
    }
  };

  const isVideo = ringing.media === "video";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Incoming call">
      <div className="modal-pop w-full max-w-sm rounded-3xl border border-white/10 bg-[#17171f] p-6 text-center shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-widest text-white/45">
          Incoming {isVideo ? "video" : "voice"} call
        </p>
        <div className="mx-auto mt-4 w-fit">
          <span className="live-dot block rounded-full">
            <UserAvatar name={ringing.caller.display_name} avatarUrl={ringing.caller.avatar_url} size={84} />
          </span>
        </div>
        <h2 className="mt-3 text-xl font-black">{ringing.caller.display_name}</h2>
        <p className="text-sm text-white/45">@{ringing.caller.username}</p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <span className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => void decline()}
              disabled={busy}
              aria-label="Decline call"
              className="rounded-full bg-red-500 p-4 text-white shadow-lg shadow-red-500/30 transition hover:bg-red-400 active:scale-95 disabled:opacity-40"
            >
              <PhoneOff size={24} />
            </button>
            <span className="text-xs font-semibold text-white/50">Decline</span>
          </span>
          <span className="flex flex-col items-center gap-1.5">
            <button
              onClick={accept}
              aria-label="Accept call"
              className="animate-pulse rounded-full bg-emerald-500 p-4 text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95"
            >
              {isVideo ? <Video size={24} /> : <Phone size={24} />}
            </button>
            <span className="text-xs font-semibold text-white/50">Accept</span>
          </span>
        </div>
        <button onClick={() => stopRingtone()} className="mt-4 text-xs font-semibold text-white/35 hover:text-white/60">
          Silence ring
        </button>
      </div>
    </div>
  );
}
