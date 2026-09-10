"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ChatPanel from "@/components/ChatPanel";

function MessagesInner() {
  const params = useSearchParams();
  return (
    <div className="h-[calc(100dvh-220px)] min-h-[480px] overflow-hidden rounded-3xl border border-white/10 bg-[#0d0d12] sm:h-[calc(100dvh-160px)]">
      <ChatPanel
        userId={params.get("userId") ?? undefined}
        conversationId={params.get("conversationId") ?? undefined}
      />
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<p className="p-6 text-center text-sm text-white/40">Loading messages…</p>}>
      <MessagesInner />
    </Suspense>
  );
}
