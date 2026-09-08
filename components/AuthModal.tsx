"use client";

import { useState } from "react";
import { LogIn, UserPlus, X } from "lucide-react";
import { useSession } from "@/stores/useSession";

export default function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const login = useSession((s) => s.login);

  if (!open) return null;

  const submit = async () => {
    const name = username.trim();
    if (!/^[A-Za-z0-9 _.-]{2,24}$/.test(name)) {
      setErr("Use 2–24 letters, numbers, spaces, _ . -");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await login(name);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="modal-pop w-full max-w-sm rounded-3xl border border-white/10 bg-[#17171f] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Join MS-ROOMS</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-sm text-white/60">Instant guest or choose a username — your ID is stored securely in Cloudflare D1 with a persistent token.</p>
        <div className="mt-4 space-y-2">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Pick a username (e.g. nightOwl_92)"
            maxLength={24}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-white placeholder:text-white/30 focus:border-violet-400/50 focus:outline-none"
          />
          {err && <p className="text-xs text-red-300">{err}</p>}
          <button
            onClick={submit}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-bold text-black transition hover:bg-white/85 disabled:opacity-50"
          >
            {busy ? "Creating…" : <><UserPlus size={16} /> Continue as {username.trim() ? username.trim() : "Guest"}</>}
          </button>
          <button
            onClick={() => {
              const guest = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
              setUsername(guest);
              setTimeout(() => submit(), 0);
            }}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"
          >
            <LogIn size={16} /> Instant Guest
          </button>
        </div>
      </div>
    </div>
  );
}
