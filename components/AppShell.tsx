"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, Home, Plus, Search, Sparkles, Trophy, User, Wallet } from "lucide-react";
import { useSession } from "@/stores/useSession";
import { levelForXp } from "@/lib/levels";
import LoginView from "@/components/LoginView";
import ServerCheckinModal from "@/components/ServerCheckinModal";
import RightRail from "@/components/RightRail";
import { UserAvatar } from "@/components/bits";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/moments", label: "Moments", icon: Sparkles },
  { href: "/rankings", label: "Rankings", icon: Trophy },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/search", label: "Search", icon: Search },
  { href: "/profile", label: "Profile", icon: User },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ready = useSession((s) => s.ready);
  const user = useSession((s) => s.user);
  const boot = useSession((s) => s.boot);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-black tracking-tight">VibeRoom</p>
          <p className="mt-1 text-sm text-white/45">Tuning the frequency…</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginView />;

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="app-sidebar">
        <Link href="/" className="flex items-center gap-2 px-2 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-lg font-black">
            V
          </span>
          <span className="text-lg font-black tracking-tight">VibeRoom</span>
        </Link>
        <nav className="flex-1 space-y-1" aria-label="Primary">
          {NAV.map((n) => (
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
            </Link>
          ))}
        </nav>
        <Link
          href="/create"
          className="mt-2 flex items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-bold text-white transition hover:opacity-90"
        >
          <Plus size={16} /> Start a room
        </Link>
        <Link href="/profile" className="mt-3 flex items-center gap-2.5 rounded-2xl bg-white/5 p-2.5 transition hover:bg-white/10">
          <UserAvatar name={user.display_name} avatarUrl={user.avatar_url} xp={user.xp} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{user.display_name}</span>
            <span className="block text-xs text-white/45">Lv.{levelForXp(user.xp)}</span>
          </span>
        </Link>
      </aside>

      {/* Main column */}
      <div className="app-main">
        {/* Mobile top bar */}
        <header className="app-topbar">
          <Link href="/" className="flex items-center gap-1.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-base font-black">
              V
            </span>
            <span className="font-black tracking-tight">VibeRoom</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/search" aria-label="Search" className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
              <Search size={16} />
            </Link>
            <Link
              href="/wallet"
              className="flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-sm font-bold text-amber-200"
            >
              <Coins size={14} />
              {user.coins.toLocaleString()}
            </Link>
          </div>
        </header>

        <main className="app-content">{children}</main>

        {/* Mobile bottom tabs */}
        <nav className="app-tabs" aria-label="Primary">
          <TabLink href="/" label="Home" icon={<Home size={20} />} active={isActive(pathname, "/") && pathname === "/"} />
          <TabLink href="/moments" label="Moments" icon={<Sparkles size={20} />} active={pathname.startsWith("/moments")} />
          <Link href="/create" aria-label="Create room" className="app-tabs-create">
            <Plus size={22} />
          </Link>
          <TabLink href="/rankings" label="Ranks" icon={<Trophy size={20} />} active={pathname.startsWith("/rankings")} />
          <TabLink href="/profile" label="Me" icon={<User size={20} />} active={pathname.startsWith("/profile")} />
        </nav>
      </div>

      {/* Desktop right rail */}
      <aside className="app-rail">
        <RightRail />
      </aside>

      <ServerCheckinModal />
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
