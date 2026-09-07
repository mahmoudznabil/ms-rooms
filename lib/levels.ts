// XP -> Level + Badge tier (Fome Party parity: visual level crown)
export interface LevelInfo {
  level: number;
  title: string;
  badge: string;
  color: string;
  nextXp: number | null;
  progress: number; // 0..1 within current level span
}

const TITLES: Array<{ minXp: number; level: number; title: string; badge: string; color: string }> = [
  { minXp: 0, level: 1, title: "New Voice", badge: "🌱", color: "#a7f3d0" },
  { minXp: 200, level: 2, title: "Chatter", badge: "💬", color: "#7dd3fc" },
  { minXp: 600, level: 3, title: "Story Seeker", badge: "🔍", color: "#c4b5fd" },
  { minXp: 1200, level: 4, title: "Room Regular", badge: "🎙️", color: "#f9a8d4" },
  { minXp: 2000, level: 5, title: "Mic Star", badge: "⭐", color: "#fcd34d" },
  { minXp: 3200, level: 6, title: "Stage Caller", badge: "🎤", color: "#fdba74" },
  { minXp: 5000, level: 7, title: "House Host", badge: "👑", color: "#facc15" },
  { minXp: 8000, level: 8, title: "Legend", badge: "🌟", color: "#f87171" },
];

export function getLevelInfo(xp: number): LevelInfo {
  const safeXp = Math.max(0, xp);
  let cur: (typeof TITLES)[number] = TITLES[0];
  let next: (typeof TITLES)[number] | null = TITLES[1] ?? null;
  for (let i = 0; i < TITLES.length; i++) {
    const t = TITLES[i] as (typeof TITLES)[number];
    const n = (TITLES[i + 1] as (typeof TITLES)[number] | undefined) ?? null;
    if (safeXp >= t.minXp && (!n || safeXp < n.minXp)) {
      cur = t;
      next = n;
      break;
    }
    if (i === TITLES.length - 1 && safeXp >= t.minXp) {
      cur = t;
      next = null;
    }
  }
  const nextXp = next ? next.minXp : null;
  const span = next ? next.minXp - cur.minXp : 1;
  const progress = next ? Math.min(1, Math.max(0, (safeXp - cur.minXp) / span)) : 1;
  return {
    level: cur.level,
    title: cur.title,
    badge: cur.badge,
    color: cur.color,
    nextXp,
    progress,
  };
}

export function levelProgress(xp: number): { level: number; target: number; pct: number } {
  const info = getLevelInfo(xp);
  const target = info.nextXp ?? info.level * 1000;
  const pct = Math.round(info.progress * 100);
  return { level: info.level, target, pct };
}

export const AVATAR_CHOICES = [
  { id: "violet", label: "Violet", css: "linear-gradient(135deg, #7c3aed, #ec4899)" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(135deg, #0ea5e9, #06b6d4)" },
  { id: "sunset", label: "Sunset", css: "linear-gradient(135deg, #f59e0b, #ef4444)" },
  { id: "forest", label: "Forest", css: "linear-gradient(135deg, #10b981, #059669)" },
  { id: "midnight", label: "Midnight", css: "linear-gradient(135deg, #1e293b, #334155)" },
  { id: "aurora", label: "Aurora", css: "linear-gradient(135deg, #8b5cf6, #06b6d4)" },
] as const;

export const FRAME_STYLES = [
  { id: "default", label: "Default", ring: "ring-white/10" },
  { id: "glow", label: "Glow", ring: "ring-violet-400/40 shadow-[0_0_18px_rgba(139,92,246,0.5)]" },
  { id: "neon", label: "Neon", ring: "ring-cyan-300/50 shadow-[0_0_18px_rgba(34,211,238,0.45)]" },
  { id: "gold", label: "Gold", ring: "ring-amber-300/60 shadow-[0_0_18px_rgba(253,224,71,0.5)]" },
  { id: "aurora", label: "Aurora", ring: "ring-fuchsia-300/40 shadow-[0_0_18px_rgba(232,121,249,0.45)]" },
] as const;

export type FrameStyle = (typeof FRAME_STYLES)[number]["id"];

// Backward-compatible helpers used by bits.tsx / AppShell / RoomView
export function levelForXp(xp: number): number {
  return getLevelInfo(xp).level;
}

export function tierForLevel(level: number): string {
  if (level >= 7) return "gold";
  if (level >= 5) return "neon";
  if (level >= 3) return "glow";
  return "default";
}

export const FRAME_RING: Record<string, string> = {
  default: "rgba(255,255,255,0.14)",
  glow: "rgba(139,92,246,0.7)",
  neon: "rgba(34,211,238,0.7)",
  gold: "rgba(253,224,71,0.75)",
  aurora: "rgba(232,121,249,0.65)",
};

export function avatarCss(avatarUrl?: string | null): string {
  if (avatarUrl) return `url("${avatarUrl}") center/cover no-repeat`;
  return "linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)";
}

export const ENTRY_EFFECT_LEVEL = 5;
