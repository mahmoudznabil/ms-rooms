"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 py-24 text-center" role="alert">
      <h1 className="text-2xl font-black">Something went wrong</h1>
      <p className="text-sm text-white/60">{error?.message || "Please try again."}</p>
      <div className="flex gap-2">
        <button onClick={() => reset()} className="rounded-2xl bg-white px-4 py-2 text-sm font-bold text-black">
          Try again
        </button>
        <Link href="/lobby" className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white">
          Lobby
        </Link>
      </div>
    </div>
  );
}
