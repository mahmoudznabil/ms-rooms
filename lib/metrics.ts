"use client";

import { getFirebaseAnalytics, getFirebasePerformance } from "@/lib/firebase";

type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

// --- Event metrics (Firebase Analytics, consent-gated) ---
export function hasAnalyticsConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem("msrooms_cookie_consent");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { consent?: string };
    return parsed.consent === "granted";
  } catch {
    return false;
  }
}
export async function logAppEvent(eventName: string, params?: AnalyticsParams): Promise<void> {
  if (typeof window === "undefined") return;
  if (!hasAnalyticsConsent()) return;
  try {
    const analytics = await getFirebaseAnalytics();
    if (!analytics) return;
    const { logEvent } = await import("firebase/analytics");
    const clean: Record<string, string | number> = {};
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === null || v === undefined) continue;
        clean[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
      }
    }
    logEvent(analytics, eventName as never, clean as never);
  } catch {
    // metrics must never break the app
  }
}

// --- Screen tracking ---
export function logScreen(screenName: string): void {
  void logAppEvent("screen_view", { screen_name: screenName });
}

// --- Auth metrics ---
export function logAuthEvent(method: "google" | "email" | "phone" | "email_link" | "guest", outcome: "success" | "failure", detail?: string): void {
  void logAppEvent("auth", { method, outcome, detail: detail?.slice(0, 100) });
}

// --- Chat / room / economy metrics ---
export function logChatEvent(action: "send" | "receive" | "open_conversation", extra?: AnalyticsParams): void {
  void logAppEvent("chat", { action, ...extra });
}
export function logGiftEvent(giftId: string, cost: number): void {
  void logAppEvent("gift_send", { gift_id: giftId, cost });
}
export function logCallEvent(action: "start" | "accept" | "reject" | "end", durationSeconds?: number): void {
  void logAppEvent("call", { action, duration_seconds: durationSeconds ?? 0 });
}

// --- AI usage metrics (what / how long / how much) ---
export function logAIEvent(feature: "reply" | "summarize" | "moderate" | "translate" | "suggest" | "topics", latencyMs: number, ok: boolean, extra?: AnalyticsParams): void {
  void logAppEvent("ai_use", { feature, latency_ms: Math.round(latencyMs), ok: ok ? 1 : 0, ...extra });
}

// --- Performance traces (Firebase Performance Monitoring) ---
export async function trace<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined") return fn();
  let stop: (() => void | Promise<void>) | null = null;
  try {
    const perf = await getFirebasePerformance();
    if (perf) {
      const { trace: makeTrace } = await import("firebase/performance");
      const t = makeTrace(perf, name);
      await t.start();
      stop = () => t.stop();
    }
  } catch {
    stop = null;
  }
  try {
    return await fn();
  } finally {
    try {
      await stop?.();
    } catch {
      // ignore
    }
  }
}
