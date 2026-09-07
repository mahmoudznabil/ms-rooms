"use client";

import { getLevelInfo, FRAME_STYLES } from "@/lib/levels";

export function ProfileBadge({
  displayName,
  idTag,
  xp,
  avatarUrl,
  frameStyle,
  size = "md",
}: {
  displayName: string;
  idTag: string;
  xp: number;
  avatarUrl?: string | null;
  frameStyle?: string;
  size?: "sm" | "md" | "lg";
}) {
  const lvl = getLevelInfo(xp);
  const frame = FRAME_STYLES.find((f) => f.id === frameStyle) ?? FRAME_STYLES[0];
  const dim = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-16 w-16 text-xl" : "h-11 w-11";
  return (
    <div className="flex items-center gap-3">
      <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 ring-2 ${frame.ring} ${dim}`}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
        ) : (
          <span className="font-extrabold text-white">{displayName.slice(0, 1).toUpperCase()}</span>
        )}
        <span
          className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-black/10 text-[10px] font-bold"
          style={{ background: lvl.color, color: "#0d0d12" }}
          title={`Level ${lvl.level}: ${lvl.title}`}
        >
          {lvl.level}
        </span>
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-bold">
          {displayName} <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/60">{idTag}</span>
        </p>
        <p className="truncate text-xs text-white/55">
          {lvl.badge} {lvl.title} · {xp.toLocaleString()} XP
        </p>
        {lvl.nextXp !== null && (
          <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(lvl.progress * 100)}%`, background: lvl.color }} />
          </div>
        )}
      </div>
    </div>
  );
}
