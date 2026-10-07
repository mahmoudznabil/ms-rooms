export default function Loading() {
  return (
    <div className="flex justify-center py-24" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-violet-400" />
        <p className="text-sm font-semibold text-white/50">Loading…</p>
      </div>
    </div>
  );
}
