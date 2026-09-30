"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Apple, Smartphone, Gamepad2, Mic, Crown, Gift, Star, Quote, Shield, Users, Headset, Sparkles, ArrowRight } from "lucide-react";
import { useSession } from "@/stores/useSession";

// Public landing (index) — lives OUTSIDE the lobby (/lobby).
// Feature-led hero + auth CTA top-left: authed users see "Go to Lobby",
// guests see "Sign Up / Log In". Dark theme.
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
  const router = useRouter();

  useEffect(() => {
    if (ready && user) {
      router.replace("/lobby");
    }
  }, [ready, user, router]);

  if (!ready) return <div className="flex justify-center py-20 text-sm text-white/40">Loading…</div>;

  const isAuthed = !!user;
  const authCta = isAuthed ? (
    <Link href="/lobby" className="shrink-0 whitespace-nowrap rounded-full bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-white/85 sm:px-5 sm:text-sm">
      Go to Lobby <ArrowRight size={14} className="ml-1 inline" />
    </Link>
  ) : (
    <Link href="/login" className="shrink-0 whitespace-nowrap rounded-full bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-white/85 sm:px-5 sm:text-sm">
      Sign Up / Log In
    </Link>
  );

  return (
    <div className="w-full pb-6">
      {/* Cloud-style top strip: full-width on all devices, inner content capped */}
      <header className="sticky left-0 right-0 top-0 z-20 w-full border-b border-white/5 bg-[#0d0d12]/90 py-2.5 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 sm:gap-3">
          <span className="flex shrink-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-8 w-8 rounded-lg bg-black/40 object-contain ring-1 ring-white/10" />
            <span className="hidden text-sm font-black tracking-tight sm:inline">MS-ROOMS</span>
          </span>
          {authCta}
          <nav className="ml-auto flex min-w-0 shrink items-center gap-0.5 text-sm font-semibold text-white/55 sm:gap-1" aria-label="Landing">
            <Link href="#features-top" className="hidden shrink-0 rounded-full px-3 py-1.5 hover:bg-white/5 hover:text-white sm:inline">Why play</Link>
            <Link href="#features" className="hidden shrink-0 rounded-full px-3 py-1.5 hover:bg-white/5 hover:text-white sm:inline">Features</Link>
            <Link href="/wallet" className="shrink-0 whitespace-nowrap rounded-full px-2 py-1.5 hover:bg-white/5 hover:text-white sm:px-3">Pricing</Link>
            <Link href="#download" className="shrink-0 whitespace-nowrap rounded-full px-2 py-1.5 hover:bg-white/5 hover:text-white sm:px-3">Download</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl space-y-10 px-4 pt-6">
      {/* Hero — what it is + why to sign up and play */}
      <section id="features-top" className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#15151d] p-6 sm:p-10">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:24px_24px] opacity-30" aria-hidden />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs font-bold text-violet-200">
            <Mic size={14} /> Live voice parties in your browser
          </p>
          <h1 className="mt-4 max-w-2xl text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            Grab a mic. Join a room. Play.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
            MS-ROOMS is live audio rooms with gifts, games, and leaderboards — no install.
            Sign up free with phone, email, or Google, get <span className="font-bold text-white">100 coins to start</span>,
            take a mic seat, and play Ludo without leaving the voice.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {isAuthed ? (
              <Link href="/lobby" className="rounded-full bg-white px-6 py-3 text-sm font-bold text-black hover:bg-white/85">
                Go to Lobby{user?.display_name ? ` — ${user.display_name}` : ""}
              </Link>
            ) : (
              <Link href="/login" className="rounded-full bg-white px-6 py-3 text-sm font-bold text-black hover:bg-white/85">
                Sign Up / Log In — play in seconds
              </Link>
            )}
            <a href="#download" className="rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white/75 hover:bg-white/10">
              <span className="inline-flex items-center gap-1.5"><Smartphone size={14} /> Get the app</span>
            </a>
            <Link href="/wallet" className="rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white/75 hover:bg-white/10">
              See pricing
            </Link>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-white/40">
            <Stars n={5} />
            <span className="font-bold text-white/60">4.82</span>
            <span>559+ reviews • 77k+ installs • 10% more value</span>
          </div>
        </div>
      </section>

      {/* Why play here */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-[#15151d] p-5">
          <Gift size={18} className="text-amber-300" />
          <p className="mt-2 text-2xl font-black">Free <span className="text-sm font-bold text-white/50">to start</span></p>
          <p className="mt-1 text-sm text-white/55">100 coins on signup plus daily check-in rewards — enough to gift and play from day one.</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-[#15151d] p-5">
          <Sparkles size={18} className="text-violet-300" />
          <p className="mt-2 text-2xl font-black">Instant <span className="text-sm font-bold text-white/50">play</span></p>
          <p className="mt-1 text-sm text-white/55">Rooms, mic seats, and Ludo run right in the browser. Apps for iOS and Android when you want them.</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-[#15151d] p-5">
          <Crown size={18} className="text-emerald-300" />
          <p className="mt-2 text-2xl font-black">Fair <span className="text-sm font-bold text-white/50">rewards</span></p>
          <p className="mt-1 text-sm text-white/55">Hosts keep 70% of gifts as gems, XP unlocks frames and crowns, recharges pay 10% more coins.</p>
        </div>
      </section>

      <section id="features" className="rounded-3xl border border-white/10 bg-[#15151d] p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-violet-300">Who we are</p>
        <h2 className="mt-1 text-xl font-black tracking-tight">A small team obsessed with voice.</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          We&apos;re MS-ROOMS — a studio portfolio turning party vibes into an open web. Live audio homes where every
          voice deserves to be heard: intimate rooms, playful gifts, fair 70% host gems, and XP that unlocks frames
          and leaderboard crowns. Small team, real support (see{" "}
          <Link href="/support" className="underline decoration-violet-400/50">Support Desk</Link>).
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
            <p className="text-xs text-white/50">A real web app you can use <span className="font-bold text-white">without install</span>, with embedded Ludo &amp; Reaction that don&apos;t break the voice.</p>
          </div>
          <div className="rounded-2xl bg-white/[0.04] p-4">
            <Crown size={18} className="text-amber-300" />
            <p className="mt-2 text-sm font-bold">Fair economy</p>
            <p className="text-xs text-white/50">Coins (hard), Gems (70% to hosts, redeemable), XP (badges). 10% cheaper than market: 27.5k / $5 vs 25k.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {isAuthed ? (
            <Link href="/lobby" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Go to Lobby → live rooms</Link>
          ) : (
            <Link href="/login" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Sign Up / Log In → live rooms</Link>
          )}
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
        <p className="mt-1 text-sm text-white/60">Ludo dice + Reaction tap run directly in the room pane. Try it after you <Link href="/lobby" className="underline">open the lobby</Link>.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {isAuthed ? (
            <Link href="/lobby" className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black">Play now — open lobby</Link>
          ) : (
            <Link href="/login" className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black">Sign up to play</Link>
          )}
          <Link href="/lobby" className="rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white">Browse rooms</Link>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#15151d] p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/50">Reviews</h2>
          <span className="flex items-center gap-1.5 text-xs text-white/50"><Star size={12} className="fill-amber-400 text-amber-400" /> 4.8 • 559 reviews • 50k+ installs</span>
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
        <p className="mx-auto mt-1 max-w-xl text-sm text-white/60">Native when you want it, web when you need it. Same login, same coins/gems/XP everywhere. 10% more value than market on every recharge.</p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <a href="#" aria-label="Download for iOS" onClick={(e) => e.preventDefault()}
            className="flex items-center justify-center gap-2 rounded-2xl bg-black px-6 py-3 text-sm font-bold text-white ring-1 ring-white/10 hover:bg-black/80">
            <Apple size={18} /> Download for iOS <span className="text-xs font-normal text-white/60">App Store — soon</span>
          </a>
          <a href="#" aria-label="Download for Android" onClick={(e) => e.preventDefault()}
            className="flex items-center justify-center gap-2 rounded-2xl bg-black px-6 py-3 text-sm font-bold text-white ring-1 ring-white/10 hover:bg-black/80">
            <Smartphone size={18} /> Download for Android <span className="text-xs font-normal text-white/60">Play — soon</span>
          </a>
        </div>
        <p className="mt-2 text-xs text-white/30">Placeholders until store review — web app is live now at <Link href="/lobby" className="underline">/lobby</Link>.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {isAuthed ? (
            <Link href="/lobby" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Go to Lobby — live now</Link>
          ) : (
            <Link href="/login" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Create account — free 100 coins</Link>
          )}
          <Link href="/wallet" className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">See 10% bonus pricing</Link>
        </div>
      </section>

      <footer className="rounded-3xl border border-white/5 bg-black/20 p-4 text-center text-xs leading-relaxed text-white/35">
        <p className="flex flex-wrap items-center justify-center gap-2">
          <span className="flex items-center gap-1"><Headset size={12} /> Support</span>
          <Link href="/support" className="underline">Help desk</Link> • <Link href="/admin" className="underline">Admin</Link> • <Link href="/wallet" className="underline">Pricing</Link> • <Link href="/lobby" className="underline">Lobby</Link>
        </p>
        <p className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Shield size={12} /> © MS-ROOMS — portfolio + live voice. Built web-first.
        </p>
      </footer>
      </div>
    </div>
  );
}
