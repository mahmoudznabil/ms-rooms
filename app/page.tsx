"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Apple,
  Smartphone,
  Mic,
  Gift,
  Gamepad2,
  Swords,
  Coins,
  Radio,
  Sparkles,
  ArrowRight,
  Shield,
  Headset,
  MessagesSquare,
  Video,
} from "lucide-react";
import { useSession } from "@/stores/useSession";

// Public landing page — shown only to signed-out visitors. Signed-in users are
// redirected to the lobby (see the effect below and AppShell's route gate).
//
// Everything advertised here is something the app actually does today. There
// are no invented review counts or install numbers: a teaser that lies about
// the product is worse than no teaser at all.

const STAGE = [
  { name: "Luna", initials: "L", speaking: true, hue: "#ff2d78" },
  { name: "Kareem", initials: "K", speaking: false, hue: "#8b5cf6" },
  { name: "Nour", initials: "N", speaking: true, hue: "#00e5a0" },
  { name: "Tarek", initials: "T", speaking: false, hue: "#ffc53d" },
  { name: "Maya", initials: "M", speaking: false, hue: "#ff2d78" },
  { name: "Omar", initials: "O", speaking: true, hue: "#8b5cf6" },
];

const WAVES = [10, 22, 34, 18, 40, 26, 14, 32, 20, 44, 24, 12, 30, 16, 38, 22];

const ROOM_FEATURES = [
  {
    icon: Mic,
    title: "Eight seats, one stage",
    body: "Take any empty seat to speak. The room shows who is talking, so nobody talks over anyone. Mute, unmute and leave whenever you want.",
  },
  {
    icon: Gift,
    title: "Gifts that actually pay the host",
    body: "Send gifts during a room. The host keeps 70% of every gift as Gems, and everyone earns XP for showing up and playing.",
  },
  {
    icon: Swords,
    title: "Gift Rush and PK battles",
    body: "Host a 60-second Gift Rush, or challenge another room to a PK battle. Send the most gift value before the timer runs out.",
  },
  {
    icon: MessagesSquare,
    title: "Chat, DMs and video calls",
    body: "Room chat for the moment, direct messages for later. Start a one-to-one voice or video call, and share your screen if you want to.",
  },
];

const GAMES = [
  { icon: "🎲", name: "Ludo Roll", body: "Roll the dice and push your token around the board." },
  { icon: "⚡", name: "Reaction", body: "Time how fast you can tap when the panel turns green." },
  { icon: "🎯", name: "Trivia", body: "Answer questions and beat your own score." },
  { icon: "🧠", name: "Memory", body: "Flip cards and match every pair in as few moves as you can." },
];

export default function Home() {
  const router = useRouter();
  const ready = useSession((s) => s.ready);
  const user = useSession((s) => s.user);

  useEffect(() => {
    if (ready && user) router.replace("/lobby");
  }, [ready, user, router]);

  if (!ready) return <div className="flex justify-center py-24 text-sm text-paper-faint">Loading…</div>;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-3">
          <span className="flex shrink-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-8 w-8 rounded-lg object-contain ring-1 ring-line-strong" />
            <span className="font-display text-base font-extrabold tracking-tight">MS-ROOMS</span>
          </span>
          <nav className="ml-auto flex items-center gap-1 text-sm font-semibold">
            <a href="#how" className="hidden rounded-full px-3 py-1.5 text-paper-dim transition hover:bg-white/5 hover:text-paper sm:block">
              How it works
            </a>
            <a href="#games" className="hidden rounded-full px-3 py-1.5 text-paper-dim transition hover:bg-white/5 hover:text-paper sm:block">
              Games
            </a>
            <a href="#apps" className="hidden rounded-full px-3 py-1.5 text-paper-dim transition hover:bg-white/5 hover:text-paper sm:block">
              Apps
            </a>
            <Link prefetch={false}
              href="/login"
              className="rounded-full bg-paper px-4 py-2 text-sm font-bold text-ink transition hover:bg-paper/85"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* ---- Hero. The one bold moment: a live stage, because the product IS a stage. ---- */}
      <section className="mx-auto w-full max-w-6xl px-5 pt-14 pb-16 sm:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-live/30 bg-live/10 px-3 py-1 text-xs font-bold text-live">
              <Radio size={13} /> Live rooms, right now
            </span>

            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">
              Grab a mic.
              <br />
              Join a room.
              <br />
              <span className="text-live">Play.</span>
            </h1>

            <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-paper-dim sm:text-lg">
              MS-ROOMS is a live voice party app that runs in your browser. Take a seat on
              stage, talk to the room, send gifts, play games together and call your friends
              one to one. Nothing to install.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link prefetch={false}
                href="/login"
                className="group inline-flex items-center gap-2 rounded-full bg-live px-6 py-3.5 text-sm font-extrabold text-white transition hover:bg-live/90 active:scale-[0.98]"
              >
                Create a free account
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link prefetch={false}
                href="/login"
                className="inline-flex items-center gap-2 rounded-full border border-line-strong px-6 py-3.5 text-sm font-bold text-paper transition hover:bg-white/5"
              >
                Sign in
              </Link>
            </div>

            <p className="mt-4 text-sm text-paper-faint">
              New accounts start with 100 coins and a 100 coin daily check-in.
            </p>
          </div>

          {/* Live stage visual */}
          <div className="relative rounded-[2rem] border border-line bg-ink-raised p-6">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold">
                <span className="live-dot inline-block h-2 w-2 rounded-full bg-live" />
                Late Check-In
              </span>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold text-paper-dim">
                Chill
              </span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              {STAGE.map((s) => (
                <div key={s.name} className="flex flex-col items-center gap-2">
                  <div
                    className={`relative flex h-14 w-14 items-center justify-center rounded-full text-lg font-extrabold text-white ${
                      s.speaking ? "ring-2 ring-join ring-offset-2 ring-offset-ink-raised" : ""
                    }`}
                    style={{ background: `linear-gradient(135deg, ${s.hue}, #2a2a3d)` }}
                  >
                    {s.initials}
                  </div>
                  <span className="max-w-full truncate text-xs font-semibold text-paper-dim">{s.name}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex h-14 items-end justify-center gap-1.5 rounded-2xl bg-black/25 px-4">
              {WAVES.map((h, i) => (
                <span
                  key={i}
                  className="wave-bar w-1.5 rounded-full bg-live"
                  style={{ height: `${h}px`, animationDelay: `${i * 70}ms` }}
                />
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between rounded-2xl bg-black/25 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-bold text-coin">
                <Coins size={15} /> 2,480
              </span>
              <span className="flex items-center gap-2 text-sm font-semibold text-paper-dim">
                <Gift size={15} /> Nadia sent 🚀
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section id="how" className="border-t border-line bg-ink-raised/40">
        <div className="mx-auto w-full max-w-6xl px-5 py-16">
          <h2 className="max-w-[24ch] text-2xl font-extrabold sm:text-3xl">What a room actually feels like</h2>
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-paper-dim sm:text-base">
            Every room is a live stage with eight seats. Listeners can sit back and listen, or
            grab a seat and join the conversation.
          </p>

          <div className="mt-9 grid gap-4 sm:grid-cols-2">
            {ROOM_FEATURES.map((f) => (
              <div key={f.title} className="rounded-3xl border border-line bg-ink-raised p-5">
                <f.icon size={20} className="text-live" />
                <h3 className="mt-3 text-base font-bold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-paper-dim">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Games ---- */}
      <section id="games" className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-5 py-16">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-extrabold sm:text-3xl">Games you can play mid-conversation</h2>
              <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-paper-dim sm:text-base">
                Play without leaving the room. The voice never drops while you do.
              </p>
            </div>
            <Gamepad2 size={28} className="text-paper-faint" />
          </div>

          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {GAMES.map((g) => (
              <div key={g.name} className="rounded-3xl border border-line bg-ink-raised p-5">
                <span className="text-3xl" aria-hidden>
                  {g.icon}
                </span>
                <h3 className="mt-3 text-base font-bold">{g.name}</h3>
                <p className="mt-1 text-sm leading-relaxed text-paper-dim">{g.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Web app ---- */}
      <section id="web" className="border-t border-line bg-ink-raised/40">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-join/30 bg-join/10 px-3 py-1 text-xs font-bold text-join">
              <Sparkles size={13} /> No download needed
            </span>
            <h2 className="mt-4 text-2xl font-extrabold sm:text-3xl">The whole app, in your browser</h2>
            <p className="mt-3 max-w-[54ch] text-sm leading-relaxed text-paper-dim sm:text-base">
              Sign in on a laptop and you get the full game: lobby, rooms, gifts, games, chat,
              voice and video calls. Audio runs on Cloudflare&apos;s global network, so a room
              sounds the same whether you are on fast fibre or a phone hotspot.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                "Voice rooms for up to eight people on stage",
                "Voice and video one-to-one calls with screen sharing",
                "Coins, Gems and XP that follow your account",
                "Works on Chrome, Edge, Safari and Firefox",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm text-paper-dim">
                  <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-join" />
                  {line}
                </li>
              ))}
            </ul>
            <Link prefetch={false}
              href="/login"
              className="mt-7 inline-flex items-center gap-2 rounded-full bg-paper px-6 py-3 text-sm font-extrabold text-ink transition hover:bg-paper/85"
            >
              Open the web app
              <ArrowRight size={16} />
            </Link>
          </div>

          <div className="rounded-[2rem] border border-line bg-ink-raised p-6">
            <p className="text-xs font-semibold text-paper-faint">Room controls</p>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {STAGE.slice(0, 4).map((s) => (
                <div key={s.name} className="flex flex-col items-center gap-2">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full text-base font-extrabold text-white ${
                      s.speaking ? "ring-2 ring-join" : ""
                    }`}
                    style={{ background: `linear-gradient(135deg, ${s.hue}, #2a2a3d)` }}
                  >
                    {s.initials}
                  </div>
                  <span className="truncate text-[11px] font-semibold text-paper-dim">{s.name}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2">
              <span className="flex items-center gap-2 rounded-full bg-join/15 px-3 py-2 text-xs font-bold text-join">
                <Mic size={13} /> Mic on
              </span>
              <span className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-xs font-semibold text-paper-dim">
                <Gift size={13} /> Gift
              </span>
              <span className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-xs font-semibold text-paper-dim">
                <Video size={13} /> Call
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Native apps ---- */}
      <section id="apps" className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-extrabold sm:text-3xl">Android and iPhone apps are on the way</h2>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-paper-dim sm:text-base">
            We are building native MS-ROOMS apps for Android and iPhone. They are still in
            development and not released yet, so there is nothing to download today. Everything
            below is what we are targeting for the first public release.
          </p>

          <div className="mt-9 grid gap-4 sm:grid-cols-2">
            {[
              {
                icon: Smartphone,
                name: "Android",
                note: "In development",
                points: [
                  "Native app with the same rooms, gifts and games",
                  "Push notifications for rooms your friends are in",
                  "Lockscreen and Bluetooth controls for the mic",
                ],
              },
              {
                icon: Apple,
                name: "iPhone",
                note: "In development",
                points: [
                  "Native app tuned for iOS audio and background handling",
                  "Same accounts, coins and Gems as the web app",
                  "Widgets for jumping straight into a live room",
                ],
              },
            ].map((app) => (
              <div key={app.name} className="rounded-3xl border border-line bg-ink-raised p-6">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5">
                    <app.icon size={20} className="text-paper-dim" />
                    <span className="font-display text-lg font-extrabold">{app.name}</span>
                  </span>
                  <span className="rounded-full border border-coin/30 bg-coin/10 px-2.5 py-1 text-[11px] font-bold text-coin">
                    {app.note}
                  </span>
                </div>
                <ul className="mt-5 space-y-2">
                  {app.points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-paper-dim">
                      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-coin" />
                      {p}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-xs text-paper-faint">
                  Nothing to install yet. Use the web app in the meantime.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Closing CTA ---- */}
      <section className="border-t border-line bg-ink-raised/40">
        <div className="mx-auto w-full max-w-3xl px-5 py-20 text-center">
          <h2 className="text-2xl font-extrabold sm:text-3xl">Start with 100 coins</h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-sm leading-relaxed text-paper-dim sm:text-base">
            Make an account, open a room, take a seat. It takes about a minute.
          </p>
          <Link prefetch={false}
            href="/login"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-live px-7 py-4 text-sm font-extrabold text-white transition hover:bg-live/90 active:scale-[0.98]"
          >
            Create your account
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-paper-faint">
          <span className="flex items-center gap-2">
            <Shield size={12} /> MS-ROOMS
          </span>
          <nav className="flex items-center gap-4">
            <Link prefetch={false} href="/login" className="transition hover:text-paper">Sign in</Link>
            <Link prefetch={false} href="/support" className="transition hover:text-paper">Support</Link>
            <span className="flex items-center gap-1.5">
              <Headset size={12} /> Audio on Cloudflare
            </span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
