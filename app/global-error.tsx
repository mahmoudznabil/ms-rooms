"use client";

import Link from "next/link";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-ink text-paper antialiased">
        <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-3 px-5 text-center">
          <h1 className="text-2xl font-black">Something went wrong</h1>
          <p className="text-sm text-white/60">Please try again. If this keeps happening, contact support.</p>
          {error?.digest ? <p className="text-xs text-white/30">Ref: {error.digest}</p> : null}
          <div className="flex gap-2">
            <button onClick={() => reset()} className="rounded-2xl bg-white px-4 py-2 text-sm font-bold text-black">
              Try again
            </button>
            <Link href="/lobby" className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white">
              Lobby
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
