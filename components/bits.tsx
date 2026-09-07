"use client";

import type { ReactNode } from "react";
import { avatarCss, FRAME_RING, levelForXp, tierForLevel } from "@/lib/levels";

export function UserAvatar({
  name,
  avatarUrl,
  size = 40,
  showFrame = true,
  xp = 0,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  showFrame?: boolean;
  xp?: number;
}) {
  const tier = tierForLevel(levelForXp(xp));
  const initial = (name.trim().slice(0, 1) || "?").toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: avatarCss(avatarUrl),
        padding: showFrame ? 2 : 0,
        border: showFrame ? "2px solid transparent" : "none",
        backgroundClip: "padding-box",
        boxShadow: showFrame ? `0 0 0 2px transparent, 0 0 0 4px rgba(255,255,255,0.08)` : undefined,
        outline: showFrame ? `2px solid transparent` : undefined,
        outlineOffset: -2,
        position: "relative",
      }}
      aria-hidden
    >
      <span
        className="flex h-full w-full items-center justify-center rounded-full"
        style={{ background: avatarCss(avatarUrl), boxShadow: showFrame ? `inset 0 0 0 2px ${FRAME_RING[tier]}` : undefined }}
      >
        {initial}
      </span>
    </span>
  );
}

export function LevelBadge({ xp, className = "" }: { xp: number; className?: string }) {
  const level = levelForXp(xp);
  return (
    <span
      className={`inline-flex items-center rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-bold text-violet-200 ${className}`}
    >
      Lv.{level}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`modal-pop w-full ${wide ? "sm:max-w-lg" : "sm:max-w-sm"} rounded-t-3xl border border-white/10 bg-[#17171f] p-5 shadow-2xl sm:rounded-3xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-white">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-white/5 px-2.5 py-1 text-sm text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/45">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none";

export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-black transition hover:bg-white/85 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-10 text-center">
      <p className="font-bold text-white/80">{title}</p>
      {hint && <p className="mt-1 text-sm text-white/45">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-10" aria-label="Loading">
      <span className="spinner" />
    </div>
  );
}
