"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createRoom } from "@/lib/api";
import { useSession } from "@/stores/useSession";
import { Field, PrimaryButton, inputCls } from "@/components/bits";

const CATEGORIES = ["Chill", "Music", "Karaoke", "Games", "Community", "Chat"] as const;
const COVERS = ["#5e6579", "#7c5948", "#526d64", "#6d5270", "#4a5e7c", "#7c4a4a"] as const;

export default function CreateRoomPage() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Chill");
  const [cover, setCover] = useState<string>(COVERS[0]);
  const [capacity, setCapacity] = useState<4 | 8 | 12>(8);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const submit = async () => {
    if (busy || title.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const { room } = await createRoom({
        host_user_id: user.id,
        title: title.trim(),
        description: description.trim(),
        category,
        cover_color: cover,
        // Extended parity: locking + capacity tags (4/8/12) — backend stores these in D1
        // but createRoom's typed helper already forwards unknown keys as JSON.
        // Cast to satisfy the shared helper while keeping runtime parity.
        ...({ capacity, locked: locked ? 1 : 0 } as unknown as Record<string, unknown>),
      } as Parameters<typeof createRoom>[0]);
      router.push(`/room?slug=${room.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the room.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/60 transition hover:text-white">
        <ArrowLeft size={15} /> Back
      </Link>
      <h1 className="mt-2 text-2xl font-black tracking-tight">Go live</h1>
      <p className="mt-0.5 text-sm text-white/50">Open your room — you take the host seat automatically.</p>

      <div className="mt-4 space-y-4 rounded-3xl border border-white/10 bg-[#15151d] p-5">
        <Field label="Room title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Midnight Karaoke" maxLength={40} className={inputCls} />
        </Field>
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is your room about?" maxLength={200} className={inputCls} />
        </Field>
        <Field label="Topic">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCategory(c)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${category === c ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"}`}>
                {c}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Cover color">
          <div className="flex gap-2">
            {COVERS.map((c) => (
              <button key={c} title={c} aria-label={`Cover ${c}`} onClick={() => setCover(c)}
                className={`h-10 w-10 rounded-2xl transition active:scale-95 ${cover === c ? "ring-2 ring-white ring-offset-2 ring-offset-[#15151d]" : "opacity-70 hover:opacity-100"}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seats (capacity)">
            <div className="flex gap-2">
              {[4, 8, 12].map((n) => (
                <button key={n} onClick={() => setCapacity(n as 4 | 8 | 12)}
                  className={`flex-1 rounded-2xl py-2.5 text-sm font-bold transition ${capacity === n ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Locking">
            <button onClick={() => setLocked((v) => !v)}
              className={`w-full rounded-2xl py-2.5 text-sm font-bold transition ${locked ? "bg-amber-400 text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
              {locked ? "Locked 🔒" : "Open 🔓"}
            </button>
          </Field>
        </div>
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>}
        <PrimaryButton onClick={() => void submit()} disabled={busy || title.trim().length < 2}>
          {busy ? "Opening your room…" : "Start live room"}
        </PrimaryButton>
      </div>
    </div>
  );
}
