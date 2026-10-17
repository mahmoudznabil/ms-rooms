"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, Home, Radio, Phone, Plus, Search, Trophy, User, Wallet, Headset, MessageCircle, LayoutDashboard } from "lucide-react";
import { useSession } from "@/stores/useSession";
import { useCalls } from "@/stores/useCalls";
import { levelForXp } from "@/lib/levels";
import ServerCheckinModal from "@/components/ServerCheckinModal";
import NotificationBell from "@/components/NotificationBell";
import OnboardingTour from "@/components/OnboardingTour";
import IncomingCallGate from "@/components/IncomingCallGate";
import LegalConsentGate from "@/components/LegalConsentGate";
import { UserAvatar } from "@/components/bits";
import { getUnreadCount } from "@/lib/api";

// LoginView pulls in FirebaseAuthPanel, and with it firebase/auth and the
// reCAPTCHA App Check script (~347 KB, ~1.5s of main-thread work). AppShell
// wraps every route, so a static import shipped all of that to every visitor —
// including the logged-out landing page, which never authenticates. next/dynamic
// keeps that cost off the critical path for people who are just browsing; the
// chunk is only requested once a login screen is actually rendered.
const LoginView = dynamic(() => import("@/components/LoginView"), {
  loading: () => <BootScreen />,
  ssr: true,
});

function BootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-violet-400" />
        <p className="text-sm font-semibold text-paper-dim">Loading…</p>
      </div>
    </div>
  );
}

function MissedBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function isActive(pathname: string, href: string, exact = false): boolean {
  if (href === "/") return pathname === "/";
  if (exact) return pathname === href;
  return pathname.startsWith(href);
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
}

const SIDEBAR_CONFIGS = {
  main: [
    { href: "/lobby", label: "Lobby", icon: Home, exact: false },
    { href: "/calls", label: "Calls", icon: Phone },
    { href: "/rankings", label: "Rankings", icon: Trophy },
    { href: "/wallet", label: "Wallet", icon: Wallet },
    { href: "/messages", label: "Messages", icon: MessageCircle },
    { href: "/search", label: "Search", icon: Search },
    { href: "/support", label: "Support", icon: Headset },
    { href: "/profile", label: "Profile", icon: User },
  ],
  // Single-page admin dashboard: all tabs live in app/admin/page.tsx.
  // Separate /admin/* routes are 404 by design (see Phase 5 hygiene).
  admin: [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  ],
  creator: [
    { href: "/create", label: "Create Room", icon: Plus },
  ],
} as const;

type SidebarConfigKey = keyof typeof SIDEBAR_CONFIGS;

function getSidebarConfig(pathname: string, isAdmin: boolean, user: { id: string } | null): { config: readonly NavItem[]; context: string } {
  if (pathname.startsWith("/admin")) {
    return { config: SIDEBAR_CONFIGS.admin, context: "admin" };
  }
  if (pathname.startsWith("/create")) {
    return { config: SIDEBAR_CONFIGS.creator, context: "creator" };
  }
  return { config: SIDEBAR_CONFIGS.main, context: "main" };
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ready = useSession((s) => s.ready);
  const user = useSession((s) => s.user);
  const boot = useSession((s) => s.boot);
  const [isAdmin, setIsAdmin] = useState(false);

  const [showTour, setShowTour] = useState(false);

  // ---- Legal consent prompt (Phase F3) --------------------------------------
  // A NEW account cannot be created without accepting the documents — that is
  // enforced server-side at /api/auth/firebase and needs no prompt here.
  //
  // A RETURNING user is a different case. On the first rollout every existing
  // account has no recorded consent, because nobody accepted text that did not
  // exist when they joined. Blocking them would lock out customers who have
  // paid and would assert a consent that never happened. So they get a
  // persistent prompt they can defer, until LEGAL_ENFORCE_RETURNS is turned on
  // alongside a real revision of the text.
  const [consentPromptOpen, setConsentPromptOpen] = useState(false);
  const [consentDeferred, setConsentDeferred] = useState(false);
  const [consentVersion, setConsentVersion] = useState("");

  useEffect(() => {
    if (!user) {
      setConsentPromptOpen(false);
      setConsentDeferred(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { fetchLegalStatus } = await import("@/lib/api");
        const status = await fetchLegalStatus();
        if (cancelled) return;
        if (!status.cleared) {
          // Deferring is remembered, but only for the current version — bump the
          // version and the prompt comes back, which is what makes a revision
          // actually reach people who dismissed the last one.
          const key = `msrooms_legal_deferred_${status.version}`;
          let deferred = false;
          try {
            deferred = localStorage.getItem(key) === "1";
          } catch {}
          setConsentVersion(status.version);
          setConsentDeferred(deferred);
          setConsentPromptOpen(!deferred);
        } else {
          setConsentPromptOpen(false);
          setConsentDeferred(false);
        }
      } catch {
        // A failed status check must never block the app; the hard gate at
        // signup is what actually protects the consent requirement.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const check = async () => {
      // Server-verified role only. No client-side email allowlist: staff emails
      // in a public bundle leak targets and render admin UI without authority.
      try {
        const { adminMe } = await import("@/lib/api");
        const r = await adminMe();
        setIsAdmin(r.admin.role === "master_admin");
      } catch { setIsAdmin(false); }
    };
    if (user) void check();
    else setIsAdmin(false);
  }, [user]);

  useEffect(() => {
    void boot();
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

  // Phase C3: the Messages tab is the unified chats+calls surface, so its
  // badge combines missed calls with unread DMs. Polled on the same cadence
  // as the missed-call badge; best-effort (a failed poll keeps the old dot).
  const [convUnread, setConvUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    void refreshMissed();
    const refreshConv = () => {
      getUnreadCount()
        .then((r) => setConvUnread(Number(r.unread_count ?? 0)))
        .catch(() => undefined);
    };
    void refreshConv();
    const t = setInterval(() => {
      void refreshMissed();
      refreshConv();
    }, 30000);
    return () => clearInterval(t);
  }, [user, refreshMissed]);

  const getContextTitle = () => {
    if (pathname.startsWith("/admin")) return "Admin Panel";
    if (pathname.startsWith("/create")) return "Creator Tools";
    return "MS-ROOMS";
  };

  // "/" is public (the marketing landing), and a signed-in visitor is bounced to
  // the lobby rather than being shown the logins again.
  const publicPaths = ["/", "/login"];
  const callPaths = ["/call"];

  if (!user) {
    if (!publicPaths.includes(pathname)) return <LoginView />;
    return <div className="w-full pb-10">{children}</div>;
  }

  if (pathname === "/") return <LoginView />;

  // Exact match only. `startsWith("/call")` also matched "/calls", so the Calls
  // tab rendered the bare page with no sidebar and no topbar — leaving no way
  // back to the lobby except the browser back button.
  if (callPaths.some((p) => pathname === p)) {
    return <div className="w-full h-full">{children}</div>;
  }

  const { config: navItems, context } = getSidebarConfig(pathname, isAdmin, user);
  const visibleNav = navItems.filter((n) => {
    // Non-admins never see admin links. Admins see them only on /admin/* where
    // the single dashboard handles all tabs (other /admin/* routes are 404).
    if (n.href === "/admin") return isAdmin && pathname === "/admin";
    if (n.href.startsWith("/admin/")) return false;
    return true;
  });

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link prefetch={false} href="/" className="flex items-center gap-2 px-2 py-4">
          <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-9 w-9 rounded-xl object-contain bg-[#0a0a12] ring-1 ring-white/10" />
          <span className="text-lg font-black tracking-tight">{getContextTitle()}</span>
        </Link>

        <nav className="flex-1 space-y-1" aria-label="Primary navigation">
          {visibleNav.map((n) => (
            <Link prefetch={false}
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                isActive(pathname, n.href, n.exact)
                  ? "bg-white text-black"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <n.icon size={17} />
              {n.label}
              {n.href === "/calls" && <MissedBadge count={missed} />}
              {n.href === "/messages" && <MissedBadge count={missed + convUnread} />}
            </Link>
          ))}
        </nav>

        {context === "main" && user && (
          <Link prefetch={false}
            href="/create"
            className="mt-2 flex items-center justify-center gap-1.5 rounded-2xl bg-arc py-3 text-sm font-bold text-white transition hover:bg-arc-hover"
          >
            <Plus size={16} /> Start a room
          </Link>
        )}

        {context === "creator" && (
          <Link prefetch={false}
            href="/create"
            className="mt-2 flex items-center justify-center gap-1.5 rounded-2xl bg-arc py-3 text-sm font-bold text-white transition hover:bg-arc-hover"
          >
            <Plus size={16} /> Create Room
          </Link>
        )}

        <div className="mt-auto pt-4 border-t border-white/10">
          <Link prefetch={false} href="/profile" className="flex items-center gap-2.5 rounded-2xl bg-white/5 p-2.5 transition-all duration-200 hover:bg-white/10 hover:scale-[1.02]">
            <UserAvatar name={user.display_name} avatarUrl={user.avatar_url} xp={user.xp} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{user.display_name}</span>
              <span className="block text-xs text-white/45">Lv.{levelForXp(user.xp)}</span>
            </span>
          </Link>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="flex min-w-0 items-center gap-2">
            <Link prefetch={false} href="/" aria-label="MS-ROOMS home" className="flex shrink-0 items-center gap-1.5">
              <img src="/ms-rooms-logo.svg" alt="MS-ROOMS" className="h-8 w-8 rounded-lg object-contain bg-[#0a0a12] ring-1 ring-white/10" />
              <span className="hidden font-black tracking-tight sm:inline">MS-ROOMS</span>
            </Link>
            {/* Lobby stays one tap away no matter which page you are on. */}
            <Link prefetch={false}
              href="/lobby"
              className={`flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold ${
                pathname.startsWith("/lobby") ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              <Radio size={13} /> Lobby
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link prefetch={false} href="/calls" aria-label="Calls" className="relative grid h-11 w-11 place-items-center rounded-full bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white">
              <Phone size={16} />
              {missed > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
                  {missed > 9 ? "9+" : missed}
                </span>
              )}
            </Link>
            <Link prefetch={false} href="/messages" aria-label="Messages" className="relative grid h-11 w-11 place-items-center rounded-full bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white">
              <MessageCircle size={16} />
              {missed + convUnread > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
                  {missed + convUnread > 9 ? "9+" : missed + convUnread}
                </span>
              )}
            </Link>
            <Link prefetch={false} href="/search" aria-label="Search" className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white">
              <Search size={16} />
            </Link>
            <NotificationBell />
            {user ? (
              <>
                <Link prefetch={false}
                  href="/wallet"
                  className="flex min-h-[44px] items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-sm font-bold text-amber-200 transition-all duration-200 hover:bg-amber-300/20 hover:scale-105"
                >
                  <Coins size={14} />
                  {user.coins.toLocaleString()}
                </Link>
                <Link prefetch={false}
                  href="/profile"
                  className="flex items-center gap-1.5 rounded-full bg-white/5 p-1 transition-all duration-200 hover:bg-white/10 hover:scale-105"
                  aria-label="Profile"
                >
                  <UserAvatar name={user.display_name} avatarUrl={user.avatar_url} xp={user.xp} size={28} />
                </Link>
              </>
            ) : (
              <Link prefetch={false} href="/login" className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black transition-all duration-200 hover:bg-white/85 hover:scale-105">
                Login
              </Link>
            )}
          </div>
        </header>

        <main className="app-content">{children}</main>

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
          <Link prefetch={false} href="/create" aria-label="Create room" className="app-tabs-create">
            <Plus size={22} />
          </Link>
          <TabLink href="/profile" label="Me" icon={<User size={20} />} active={pathname.startsWith("/profile")} />
        </nav>

        <ServerCheckinModal />
        {showTour && user && <OnboardingTour user={user} onDone={finishTour} />}

        {/* Legal consent prompt for a returning user (Phase F3). Deliberately
            not blocking: the server only hard-blocks at signup, and until the
            text is genuinely revised this must not lock out someone who has
            already paid. Deferred, it collapses to a one-line reminder that
            stays reachable. */}
        {consentPromptOpen && (
          <LegalConsentGate
            mode="session"
            dismissable
            onCancel={() => {
              try {
                localStorage.setItem(`msrooms_legal_deferred_${consentVersion}`, "1");
              } catch {}
              setConsentPromptOpen(false);
              setConsentDeferred(true);
            }}
            onAccepted={() => setConsentPromptOpen(false)}
          />
        )}
        {consentDeferred && (
          <button
            type="button"
            onClick={() => setConsentPromptOpen(true)}
            className="border-t border-amber-400/20 bg-amber-400/10 px-4 py-2 text-center text-xs font-bold text-amber-200 transition hover:bg-amber-400/15"
          >
            Review the updated Terms, Privacy Policy and Community Guidelines →
          </button>
        )}

        {/* Standing legal link. Always reachable, and it deep-links into the
            bilingual reader rather than to a hand-maintained copy. */}
        <div className="border-t border-white/5 px-4 py-3 text-center text-[11px] text-white/30">
          <Link
            prefetch={false}
            href="/legal"
            className="mx-2 hover:text-white/55 hover:underline"
          >
            Terms of Service
          </Link>
          <Link
            prefetch={false}
            href="/legal#privacy"
            className="mx-2 hover:text-white/55 hover:underline"
          >
            Privacy Policy
          </Link>
          <Link
            prefetch={false}
            href="/legal#guidelines"
            className="mx-2 hover:text-white/55 hover:underline"
          >
            Community Guidelines
          </Link>
        </div>

        <Suspense fallback={null}>
          <IncomingCallGate />
        </Suspense>
      </div>
    </div>
  );
}

function TabLink({ href, label, icon, active, exact = false }: { href: string; label: string; icon: ReactNode; active: boolean; exact?: boolean }) {
  return (
    <Link prefetch={false}
      href={href}
      className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-[11px] font-semibold transition ${
        active ? "text-white" : "text-white/40 hover:text-white/70"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}