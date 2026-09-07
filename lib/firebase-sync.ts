"use client";

import type { User } from "firebase/auth";
import { API_BASE, ApiError } from "@/lib/api";

/**
 * Exchange a Firebase ID token for a D1-backed app user + 30-day session token.
 * This is how progress (coins/xp/streak/rooms/moments) follows the user across devices:
 * Firebase is the identity (phone/email/Google), D1 is the source of truth keyed by firebase_uid.
 * The Worker verifies the ID token via google tokeninfo and upserts the D1 row atomically.
 */
export async function syncFirebaseUser(firebaseUser: User): Promise<{ user: import("@/lib/api").ApiUser; token: string }> {
  const idToken = await firebaseUser.getIdToken(true);
  const res = await fetch(`${API_BASE}/api/auth/firebase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      firebase_uid: firebaseUser.uid,
      email: firebaseUser.email ?? null,
      phone: firebaseUser.phoneNumber ?? null,
      display_name: firebaseUser.displayName ?? null,
      avatar_url: firebaseUser.photoURL ?? null,
      provider: firebaseUser.providerData[0]?.providerId ?? "firebase",
    }),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; user?: import("@/lib/api").ApiUser; token?: string; error?: string } | null;
  if (!res.ok || !data?.ok || !data.user || !data.token) {
    throw new ApiError(data?.error ?? `Firebase sync failed (${res.status})`, res.status);
  }
  return { user: data.user, token: data.token };
}

export async function syncIdToken(idToken: string, profile: { firebase_uid: string; email?: string | null; phone?: string | null; display_name?: string | null; avatar_url?: string | null }): Promise<{ user: import("@/lib/api").ApiUser; token: string }> {
  const res = await fetch(`${API_BASE}/api/auth/firebase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(profile),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; user?: import("@/lib/api").ApiUser; token?: string; error?: string } | null;
  if (!res.ok || !data?.ok || !data.user || !data.token) {
    throw new ApiError(data?.error ?? `Firebase sync failed (${res.status})`, res.status);
  }
  return { user: data.user, token: data.token };
}
