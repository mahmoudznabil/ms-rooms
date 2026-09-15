"use client";

import { useState } from "react";
import Link from "next/link";
import { PartyPopper, Fingerprint, Users, Gift, UserRoundPen, ArrowRight, ArrowLeft, X } from "lucide-react";
import type { ApiUser } from "@/lib/api";

// First-run walkthrough — shown ONCE, only for brand-new signups (AppShell
// gates on the msrooms_new_signup session flag + a per-user localStorage
// mark). Walks features, then profile setup. Consumers never see admin.
const STEPS = [
  {
    icon: PartyPopper,
    title: "Welcome to MS-ROOMS!",
    body: (u: ApiUser) =>
      `Your account is ready and we've dropped ${u.coins.toLocaleString()} coins in your wallet. Here's a 30-second tour.`,
  },
  {
    icon: Fingerprint,
    title: "Your unique ID",
    body: (u: ApiUser) =>
      `You're ${u.display_name} (@${u.username})${u.id_tag ? ` — tag ${u.id_tag}` : ""}. Friends find you by name or tag, and it links all your progress across devices.`,
  },
  {
    icon: Users,
    title: "Find your vibe",
    body: () =>
      "Browse the lobby for live voice rooms — chill, music, karaoke, games. Tap a room to join, grab a seat, and talk straight from your browser. No install.",
  },
  {
    icon: Gift,
    title: "Gifts, games & levels",
    body: () =>
      "Send gifts to hosts, play Ludo and reactions without leaving voice, earn XP to level up and unlock frames. Hosts keep 70% of gifts as Gems.",
  },
  {
    icon: UserRoundPen,
    title: "Make it yours",
    body: () =>
      "Set your display name, avatar and bio so rooms recognize you. Takes ten seconds.",
  },
];

export default function OnboardingTour({ user, onDone }: { user: ApiUser; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];
  const Icon = s.icon;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="modal-pop w-full max-w-sm rounded-3xl border border-white/10 bg-[#17171f] p-6 text-center shadow-2xl">
        <div className="flex justify-end">
          <button onClick={onDone} aria-label="Skip tour" className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200">
          <Icon size={28} />
        </div>
        <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-white/35">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 className="mt-1 text-lg font-extrabold text-white">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{s.body(user)}</p>

        <div className="mt-3 flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition ${i === step ? "w-5 bg-violet-400" : i < step ? "w-1.5 bg-violet-400/50" : "w-1.5 bg-white/15"}`} />
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} className="flex items-center justify-center gap-1 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15">
              <ArrowLeft size={15} /> Back
            </button>
          ) : (
            <button onClick={onDone} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white/60 transition hover:bg-white/15">
              Skip
            </button>
          )}
          {last ? (
            <Link
              href="/profile"
              onClick={onDone}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white py-3 text-sm font-bold text-black transition hover:bg-white/85"
            >
              Complete your profile <ArrowRight size={15} />
            </Link>
          ) : (
            <button onClick={() => setStep(step + 1)} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white py-3 text-sm font-bold text-black transition hover:bg-white/85">
              Next <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
