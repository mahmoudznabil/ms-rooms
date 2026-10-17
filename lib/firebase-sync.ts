"use client";

import type { User } from "firebase/auth";
import {
  API_BASE,
  ApiError,
  timeoutSignal,
  type ApiLegalAccept,
  type LegalLang,
} from "@/lib/api";

/**
 * Exchange a Firebase ID token for a D1-backed app user + 30-day session token.
 * This is how progress (coins/xp/streak/rooms) follows the user across devices:
 * Firebase is the identity (phone/email/Google), D1 is the source of truth keyed by firebase_uid.
 * The Worker verifies the ID token via google tokeninfo and upserts the D1 row atomically.
 */
export async function syncFirebaseUser(firebaseUser: User): Promise<{ user: import("@/lib/api").ApiUser; isNew: boolean }> {
  const idToken = await firebaseUser.getIdToken(true);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/firebase`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        firebase_uid: firebaseUser.uid,
        email: firebaseUser.email ?? null,
        phone: firebaseUser.phoneNumber ?? null,
        display_name: firebaseUser.displayName ?? null,
        avatar_url: firebaseUser.photoURL ?? null,
        provider: firebaseUser.providerData[0]?.providerId ?? "firebase",
      }),
      // Bounded: a stalled sync must surface an error, never spin forever.
      signal: timeoutSignal(20000),
    });
  } catch (e) {
    throw new ApiError(e instanceof DOMException && e.name === "TimeoutError"
      ? "Account sync timed out — check your connection and try signing in again."
      : "Could not reach the server — check your connection and try signing in again.", 0);
  }
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    user?: import("@/lib/api").ApiUser;
    isNew?: boolean;
    error?: string;
    code?: string;
    outstanding?: string[];
  } | null;
  if (!res.ok || !data?.ok || !data.user) {
    // 428 legal_consent_required is not a failure — it is the server refusing to
    // create an account for someone who has not accepted the documents yet.
    // Surfacing it as a distinct type lets the auth panel open the consent gate
    // instead of showing a red error the user cannot act on.
    if (res.status === 428 && data?.code === "legal_consent_required") {
      throw new LegalConsentRequiredError(data.outstanding ?? []);
    }
    throw new ApiError(data?.error ?? `Firebase sync failed (${res.status})`, res.status);
  }
  return { user: data.user, isNew: data.isNew === true };
}

/**
 * The server will not create an account until the Terms, Privacy Policy and
 * Community Guidelines have been accepted at the current version.
 *
 * Thrown by `syncFirebaseUser` rather than returned as a result, so every
 * existing caller keeps compiling and the refusal cannot be accidentally
 * ignored into a half-registered state.
 */
export class LegalConsentRequiredError extends Error {
  readonly outstanding: string[];

  constructor(outstanding: string[] = []) {
    super("You must accept the Terms of Service, Privacy Policy and Community Guidelines first.");
    this.name = "LegalConsentRequiredError";
    this.outstanding = outstanding;
  }
}

/**
 * Record acceptance of the legal documents.
 *
 * Uses the Firebase bearer token rather than the session cookie, because this
 * runs BEFORE any account exists: at signup the only credential the browser
 * holds is a Firebase ID token, and there is no `users` row for a consent record
 * to hang off yet. The server keys the record on the provider's user id and
 * attaches it to the account as soon as it is created.
 *
 * `docs` must name the current version of each document. The server rejects
 * anything else, so a stale build cannot record consent against text the
 * customer never saw.
 */
export async function recordLegalConsent(
  idToken: string,
  input: { lang: LegalLang; docs: Array<{ key: string; version: string }>; ageConfirmed: boolean }
): Promise<ApiLegalAccept> {
  const res = await fetch(`${API_BASE}/api/legal/accept`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      lang: input.lang,
      age_confirmed: input.ageConfirmed,
      docs: input.docs.map((d) => ({ key: d.key, version: d.version })),
    }),
    signal: timeoutSignal(20000),
  });
  const data = (await res.json().catch(() => null)) as ApiLegalAccept & { error?: string } | null;
  if (!res.ok || !data?.ok) {
    throw new ApiError(data?.error ?? `Could not record your acceptance (${res.status})`, res.status);
  }
  return data;
}

export async function syncIdToken(idToken: string, profile: { firebase_uid: string; email?: string | null; phone?: string | null; display_name?: string | null; avatar_url?: string | null }): Promise<{ user: import("@/lib/api").ApiUser }> {
  const res = await fetch(`${API_BASE}/api/auth/firebase`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(profile),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    user?: import("@/lib/api").ApiUser;
    error?: string;
    code?: string;
    outstanding?: string[];
  } | null;
  if (!res.ok || !data?.ok || !data.user) {
    if (res.status === 428 && data?.code === "legal_consent_required") {
      throw new LegalConsentRequiredError(data.outstanding ?? []);
    }
    throw new ApiError(data?.error ?? `Firebase sync failed (${res.status})`, res.status);
  }
  return { user: data.user };
}
