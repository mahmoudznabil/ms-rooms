"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, Home, Phone, Plus, Search, Sparkles, Trophy, User, Wallet, Shield, Headset, MessageCircle } from "lucide-react";
import { useSession } from "@/stores/useSession";
import { useCalls } from "@/stores/useCalls";
import { levelForXp } from "@/lib/levels";
import LoginView from "@/components/LoginView";
import ServerCheckinModal from "@/components/ServerCheckinModal";
import OnboardingTour from "@/components/OnboardingTour";
import IncomingCallGate from "@/components/IncomingCallGate";
import RightRail from "@/components/RightRail";
import { UserAvatar } from "@/components/bits";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/moments", label: "Moments", icon: Sparkles },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/rankings", label: "Rankings", icon: Trophy },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/search", label: "Search", icon: Search },
  { href: "/support", label: "Support", icon: Headset },
  { href: "/admin", label: "Admin", icon: Shield },
  { href: "/profile", label: "Profile", icon: User },
];

function MissedBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ready = useSession((s) => s.ready);
  const user = useSession((s) => s.user);
  const boot = useSession((s) => s.boot);
  const [isAdmin, setIsAdmin] = useState(false);
  // First-run tour: only brand-new signups (panel sets the session flag on
  // fresh account creation), once per user. Consumers never see admin.
  const [showTour, setShowTour] = useState(false);
  // Only Marc + Mahmoud see Admin — hidden from public
  const ADMIN_ALLOW = ["mahmoudnabil03@gmail.com", "marc@ms-rooms.app", "marc@gmail.com", "marc@msrooms.app"];
  useEffect(() => {
    const check = async () => {
      const email = (user as unknown as { email?: string | null })?.email ?? null;
      if (email && ADMIN_ALLOW.includes(email.toLowerCase())) { setIsAdmin(true); return; }
      const tok = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
      if (!tok) { setIsAdmin(false); return; }
      try {
        const { adminMe } = await import("@/lib/api");
        const r = await adminMe();
        setIsAdmin(r.admin.role === "master_admin");
      } catch { setIsAdmin(false); }
    };
    void check();
  }, [user]);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    try {
      const fresh = sessionStorage.getItem("msrooms_new_signup") === "1";
      const done = localStorage.getItem(`msrooms_tour_${user.id}`);
      if (fresh && !done) setShowTour(true);
    } catch {}
  }, [user]);

  const finishTour = () => {
    try {
      if (user) localStorage.setItem(`msrooms_tour_${user.id}`, "1");
      sessionStorage.removeItem("msrooms_new_signup");
    } catch {}
    setShowTour(false);
  };

  const missed = useCalls((s) => s.missed);
  const refreshMissed = useCalls((s) => s.refreshMissed);
  useEffect(() => {
    if (!user) return;
    void refreshMissed();
    const t = setInterval(() => void refreshMissed(), 30000);
    return () => clearInterval(t);
  }, [user, refreshMissed]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-16 w-16 rounded-2xl object-contain" />
          </div>
          <p className="mt-3 text-2xl font-black tracking-tight">MS-ROOMS</p>
          <p className="mt-1 text-sm text-white/45">Tuning the frequency…</p>
        </div>
      </div>
    );
  }

  const publicPaths = ["/", "/login"];
  // Signed OUT: no sidebar / topbar / tabs / rail — the public landing brings
  // its own top nav and /login is self-contained. The chrome only exists
  // once you're signed in.
  if (!user) {
    if (!publicPaths.includes(pathname)) return <LoginView />;
    // Full-width wrapper so the public landing header can span edge-to-edge
    // on all devices; inner pages constrain their own content width.
    return <div className="w-full pb-10">{children}</div>;
  }
  const visibleNav = NAV.filter((n) => n.href !== "/admin" || isAdmin);
  // Direct /admin access without admin token → show admin login page, but hide tab from public nav

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="app-sidebar">
        <Link href="/" className="flex items-center gap-2 px-2 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-9 w-9 rounded-xl object-contain bg-[#0a0a12] ring-1 ring-white/10" />
          <span className="text-lg font-black tracking-tight">MS-ROOMS</span>
        </Link>
        <nav className="flex-1 space-y-1" aria-label="Primary">
          {visibleNav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                isActive(pathname, n.href)
                  ? "bg-white text-black"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <n.icon size={17} />
              {n.label}
              {n.href === "/calls" && <MissedBadge count={missed} />}
            </Link>
          ))}
        </nav>
        <Link
          href="/create"
          className="mt-2 flex items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-bold text-white transition hover:opacity-90"
        >
          <Plus size={16} /> Start a room
        </Link>
        {user ? (
          <Link href="/profile" className="mt-3 flex items-center gap-2.5 rounded-2xl bg-white/5 p-2.5 transition hover:bg-white/10">
            <UserAvatar name={user.display_name} avatarUrl={user.avatar_url} xp={user.xp} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{user.display_name}</span>
              <span className="block text-xs text-white/45">Lv.{levelForXp(user.xp)}</span>
            </span>
          </Link>
        ) : (
          <Link href="/login" className="mt-3 flex items-center justify-center rounded-2xl bg-white py-3 text-sm font-bold text-black hover:bg-white/85">
            Login / Sign up
          </Link>
        )}
      </aside>

      {/* Main column */}
      <div className="app-main">
        {/* Mobile top bar */}
        <header className="app-topbar">
          <Link href="/" className="flex items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-8 w-8 rounded-lg object-contain bg-[#0a0a12] ring-1 ring-white/10" />
            <span className="font-black tracking-tight">MS-ROOMS</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/calls" aria-label="Calls" className="relative rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
              <Phone size={16} />
              {missed > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
                  {missed > 9 ? "9+" : missed}
                </span>
              )}
            </Link>
            <Link href="/messages" aria-label="Messages" className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
              <MessageCircle size={16} />
            </Link>
            <Link href="/search" aria-label="Search" className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
              <Search size={16} />
            </Link>
            {user ? (
              <Link
                href="/wallet"
                className="flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-sm font-bold text-amber-200"
              >
                <Coins size={14} />
                {user.coins.toLocaleString()}
              </Link>
            ) : (
              <Link href="/login" className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black hover:bg-white/85">
                Login
              </Link>
            )}
          </div>
        </header>

        <main className="app-content">{children}</main>

        {/* Mobile bottom tabs */}
        <nav className="app-tabs" aria-label="Primary">
          <TabLink href="/" label="Home" icon={<Home size={20} />} active={pathname === "/"} />
          <TabLink
            href="/calls"
            label="Calls"
            icon={
              <span className="relative">
                <Phone size={20} />
                {missed > 0 && (
                  <span className="absolute -right-2 -top-1.5 rounded-full bg-red-500 px-1 text-[9px] font-black leading-tight text-white">
                    {missed > 9 ? "9+" : missed}
                  </span>
                )}
              </span>
            }
            active={pathname.startsWith("/calls") || pathname.startsWith("/call")}
          />
          <Link href="/create" aria-label="Create room" className="app-tabs-create">
            <Plus size={22} />
          </Link>
          <TabLink href="/moments" label="Moments" icon={<Sparkles size={20} />} active={pathname.startsWith("/moments")} />
          <TabLink href="/profile" label="Me" icon={<User size={20} />} active={pathname.startsWith("/profile")} />
        </nav>
      </div>

      {/* Desktop right rail */}
      <aside className="app-rail">
        <RightRail />
      </aside>

      <ServerCheckinModal />
      {showTour && user && <OnboardingTour user={user} onDone={finishTour} />}
      <Suspense fallback={null}>
        <IncomingCallGate />
      </Suspense>
    </div>
  );
}

function TabLink({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-[11px] font-semibold transition ${
        active ? "text-white" : "text-white/40 hover:text-white/70"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}
