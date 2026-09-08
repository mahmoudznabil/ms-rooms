"use client";

import Link from "next/link";
import { Apple, Smartphone, Gamepad2, Mic, Crown, Gift, Star, Quote, Shield, Users, Headset } from "lucide-react";
import { useSession } from "@/stores/useSession";

// Portfolio landing — public homepage for guests; authenticated users see live lobby directly
const REVIEWS = [
  { name: "Alya R.", stars: 5, text: "Finally a voice party I can join from my laptop! No install, just click and talk. Rooms feel alive.", date: "2 days ago", tag: "Web UI" },
  { name: "Khaled M.", stars: 5, text: "Gifts and PK battles are crazy fun. I earned gems hosting and my XP actually unlocks frames.", date: "1 week ago", tag: "Host" },
  { name: "Sofia L.", stars: 4, text: "Love the karaoke rooms and Ludo inside the voice chat. Would love more themes but super smooth.", date: "3 days ago", tag: "Games" },
  { name: "Omar J.", stars: 5, text: "Phone + Google sign-in works everywhere. Started on web, continued on Android — all coins followed me.", date: "5 days ago", tag: "Cross-device" },
  { name: "Noura S.", stars: 4, text: "Support replied in hours when my top-up was late. The 10% bonus is real — 27.5k for $5!", date: "1 week ago", tag: "Support" },
  { name: "Dev P.", stars: 5, text: "Best audio quality on Cloudflare. No lag even with 12 seats. The web game is a killer differentiator.", date: "4 days ago", tag: "Audio" },
];

const SCREENSHOTS = [
  { title: "Live lobby", desc: "Chill • Music • Karaoke • Games", color: "#5e6579", icon: Users },
  { title: "8-seat stage", desc: "Tap to take mic, host controls", color: "#7c5948", icon: Mic },
  { title: "Gifts & Gems", desc: "70% to host as Gems", color: "#7c3aed", icon: Gift },
  { title: "Ludo + Reaction", desc: "Play without leaving voice", color: "#0ea5e9", icon: Gamepad2 },
];

function Stars({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={12} className={i < n ? "fill-amber-400 text-amber-400" : "text-white/20"} />
      ))}
    </span>
  );
}

export default function Home() {
  const ready = useSession((s) => s.ready);
  const user = useSession((s) => s.user);

  if (!ready) return <div className="flex justify-center py-20 text-sm text-white/40">Loading…</div>;

  const isAuthed = !!user;

  return (
    <div className="space-y-10 pb-6">
      {/* Blackbox-style hero — minimal, centered, no choice bar */}
      <section className="relative overflow-hidden rounded-2xl border border-white/5 bg-[#0f0f10] p-6 sm:p-10">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:24px_24px] opacity-30" aria-hidden />
        <div className="relative text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-black/40 ring-1 ring-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
            Voice parties, live in your browser.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/45">
            The Fomi Party vibe — rebuilt web-first. No APK to install. Real login (phone/email/Google) that follows you on every device, with a <span className="text-white/70">usable Web UI + games</span>.
          </p>
          {/* Blackbox-style input mock */}
          <div className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border border-white/10 bg-black/40 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-white/40">
              <Mic size={14} />
            </div>
            <span className="flex-1 text-left text-sm text-white/30">Try “Join a chill room…”</span>
            {isAuthed ? (
              <Link href="/lobby" className="shrink-0 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90">
                Go to lobby
              </Link>
            ) : (
              <Link href="/login" className="shrink-0 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90">
                Login
              </Link>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {isAuthed ? (
              <Link href="/lobby" className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90">Open lobby — {user?.display_name}</Link>
            ) : (
              <Link href="/login" className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90">Login / Sign up</Link>
            )}
            <a href="#download" className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10">
              <span className="inline-flex items-center gap-1.5"><Apple size={14} /> iOS</span>
            </a>
            <a href="#download" className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10">
              <span className="inline-flex items-center gap-1.5"><Smartphone size={14} /> Android</span>
            </a>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/25">
            <Stars n={5} />
            <span className="font-medium text-white/50">4.82</span>
            <span>559+ reviews • 77k+ installs • 10% more value</span>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#15151d] p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-violet-300">Who we are</p>
        <h2 className="mt-1 text-xl font-black tracking-tight">A small team obsessed with voice.</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          We’re MS-ROOMS — a studio portfolio turning “Fomi Party” vibes into an open web. We build live audio homes where every voice deserves to be heard: intimate rooms, playful gifts, fair 70% host gems, and XP that actually unlocks frames and leaderboard crowns. Small team, real support (see <Link href="/support" className="underline decoration-violet-400/50">Support Desk</Link>), and a Master Admin panel that keeps recharges and tickets honest.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/[0.04] p-4">
            <Mic size={18} className="text-violet-300" />
            <p className="mt-2 text-sm font-bold">Cloudflare Realtime</p>
            <p className="text-xs text-white/50">Low-latency voice on Cloudflare Calls SFU + TURN. 8–12 seats, mute/lock, host controls.</p>
          </div>
          <div className="rounded-2xl bg-white/[0.04] p-4">
            <Gamepad2 size={18} className="text-fuchsia-300" />
            <p className="mt-2 text-sm font-bold">Usable Web UI + Games</p>
            <p className="text-xs text-white/50">Our difference: a real web app you can use <span className="font-bold text-white">without install</span>, with embedded Ludo & Reaction that don’t break the voice.</p>
          </div>
          <div className="rounded-2xl bg-white/[0.04] p-4">
            <Crown size={18} className="text-amber-300" />
            <p className="mt-2 text-sm font-bold">Fair economy</p>
            <p className="text-xs text-white/50">Coins (hard), Gems (70% to hosts, redeemable), XP (badges). 10% cheaper than market: 27.5k / $5 vs 25k.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/lobby" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Enter Web App → Live lobby</Link>
          <Link href="/wallet" className="rounded-full bg-white/5 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/10">See pricing</Link>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/50">Screenshots</h2>
          <span className="text-xs text-white/30">Web UI • not just app APK</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SCREENSHOTS.map((s) => (
            <div key={s.title} className="overflow-hidden rounded-3xl border border-white/10 bg-[#15151d]">
              <div className="flex h-36 items-center justify-center" style={{ background: `linear-gradient(135deg, ${s.color}, #0d0d12)` }}>
                <s.icon size={34} className="text-white/85" />
              </div>
              <div className="p-3">
                <p className="text-sm font-bold">{s.title}</p>
                <p className="text-xs text-white/45">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-white/30">Swipe lobby → take a mic seat → send gifts → play — all inside the browser.</p>
      </section>

      <section className="rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/10 to-violet-500/10 p-6">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-fuchsia-200"><Gamepad2 size={13} /> Our main difference: usable web game</p>
        <h3 className="mt-1 text-lg font-black">Voice + play, no download.</h3>
        <p className="mt-1 text-sm text-white/60">Fomi Party keeps games inside the APK. MS-ROOMS runs <span className="font-bold text-white">Ludo dice + Reaction tap</span> directly in the room pane — state syncs locally, never breaks the mobile frame. Try it after you <Link href="/room?slug=late-check-in" className="underline">join a room</Link>.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {isAuthed ? (
            <Link href="/lobby" className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black">Play now — open lobby</Link>
          ) : (
            <Link href="/login" className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black">Login to play</Link>
          )}
          <Link href="/lobby" className="rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white">Browse rooms</Link>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#15151d] p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/50">Reviews</h2>
          <span className="flex items-center gap-1.5 text-xs text-white/50"><Star size={12} className="fill-amber-400 text-amber-400" /> 4.8 • 559 reviews • 50k+ installs (inspired by Fomi)</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {REVIEWS.map((r) => (
            <div key={r.name} className="rounded-2xl bg-white/[0.04] p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">{r.name}</p>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50">{r.tag}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Stars n={r.stars} />
                <span className="text-xs text-white/40">{r.date}</span>
              </div>
              <p className="mt-2 flex gap-1.5 text-sm leading-relaxed text-white/75">
                <Quote size={14} className="mt-0.5 shrink-0 text-white/20" /> {r.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="download" className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600/15 to-fuchsia-600/10 p-6 text-center">
        <h2 className="text-xl font-black tracking-tight">Get the app — or just use the web.</h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-white/60">Native when you want it, web when you need it. Same Firebase login, same coins/gems/XP on D1. 10% more value than market on every recharge.</p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <a href="#" aria-label="Download for iOS" onClick={(e) => e.preventDefault()}
            className="flex items-center justify-center gap-2 rounded-2xl bg-black px-6 py-3 text-sm font-bold text-white ring-1 ring-white/10 hover:bg-black/80">
            <Apple size={18} /> Download for iOS <span className="text-xs font-normal text-white/60">App Store — soon</span>
          </a>
          <a href="#" aria-label="Download for Android" onClick={(e) => e.preventDefault()}
            className="flex items-center justify-center gap-2 rounded-2xl bg-black px-6 py-3 text-sm font-bold text-white ring-1 ring-white/10 hover:bg-black/80">
            <Smartphone size={18} /> Download for Android <span className="text-xs font-normal text-white/60">Play — mzn.muse.bestaudioroom</span>
          </a>
        </div>
        <p className="mt-2 text-xs text-white/30">Placeholders until store review — web app is live now at <Link href="/lobby" className="underline">/lobby</Link>. APK uses `android/app/google-services.json`.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {isAuthed ? (
            <Link href="/lobby" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Open lobby — live now</Link>
          ) : (
            <Link href="/login" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Create account — free 100 coins</Link>
          )}
          <Link href="/wallet" className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">See 10% bonus pricing</Link>
        </div>
      </section>

      <footer className="rounded-3xl border border-white/5 bg-black/20 p-4 text-center text-xs leading-relaxed text-white/35">
        <p className="flex flex-wrap items-center justify-center gap-2">
          <span className="flex items-center gap-1"><Headset size={12} /> Support</span>
          <Link href="/support" className="underline">Help desk</Link> • <Link href="/admin" className="underline">Admin</Link> • <Link href="/wallet" className="underline">Pricing</Link> • Firebase Auth: phone, email, email-link, Google → D1 `firebase_uid` sync.
        </p>
        <p className="mt-1">© MS-ROOMS — portfolio + live voice. Built for web-first parties. Fomi Party is a trademark of its owner; we’re an independent homage with a usable web game.</p>
      </footer>
    </div>
  );
}
