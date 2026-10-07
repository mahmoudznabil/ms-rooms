import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-black">Page not found</h1>
      <p className="text-sm text-white/60">That page does not exist.</p>
      <Link href="/lobby" className="rounded-2xl bg-white px-4 py-2 text-sm font-bold text-black">
        Back to lobby
      </Link>
    </div>
  );
}
