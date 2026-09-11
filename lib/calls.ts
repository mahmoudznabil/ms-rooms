"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ApiError, startCall, type CallMedia } from "@/lib/api";

/**
 * Shared "place a call" flow used by search, profiles, chat headers and the
 * Calls tab recents: creates the ringing session, then opens the call screen.
 * Returns an error string when it can't (caller shows it as a notice).
 */
export async function placeCall(
  peerId: string,
  callerId: string,
  media: CallMedia,
  router: AppRouterInstance
): Promise<string | null> {
  if (!callerId) return "Sign in to call.";
  if (peerId === callerId) return "You can't call yourself.";
  try {
    const { room } = await startCall(peerId, callerId, media);
    router.push(`/call?room=${encodeURIComponent(room.slug)}`);
    return null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      return "A call is already active between you two — check your Calls tab.";
    }
    return e instanceof Error ? e.message : "Couldn't start the call. Try again.";
  }
}
