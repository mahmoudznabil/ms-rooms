/**
 * Pure validator for server-side trivia packs (Phase B).
 *
 * Lives in `workers/` (not `lib/games/`) because `workers/backend.ts` is
 * deliberately dependency-free — it must bundle for the Pages Function
 * without the app's `@/` alias or React-adjacent modules. `workers/auth.ts`
 * is the precedent for this placement.
 *
 * The same shape is enforced in three places, all through this module on the
 * server side (the browser re-checks in `fetchTriviaPack`, `lib/api.ts`):
 *   1. `POST /api/admin/trivia/generate` — rejects malformed LLM output and
 *      stores nothing;
 *   2. `GET /api/trivia/pack` — never serves a stored pack that fails this
 *      (a bad row reads as "no pack", i.e. client falls back to static).
 *
 * Shape: an array of exactly 5 { q, options[4 unique non-empty], correct }.
 */

export interface ServerTriviaQuestion {
  q: string;
  options: string[];
  correct: number;
}

export function isValidTriviaPack(candidate: unknown): candidate is ServerTriviaQuestion[] {
  if (!Array.isArray(candidate) || candidate.length !== 5) return false;
  return candidate.every((q) => {
    if (q === null || typeof q !== "object") return false;
    const item = q as Record<string, unknown>;
    if (typeof item.q !== "string" || item.q.trim().length === 0) return false;
    if (!Array.isArray(item.options) || item.options.length !== 4) return false;
    const options = item.options as unknown[];
    if (!options.every((o) => typeof o === "string" && (o as string).trim().length > 0)) return false;
    if (new Set(options.map(String)).size !== 4) return false;
    if (!Number.isInteger(item.correct)) return false;
    const correct = item.correct as number;
    return correct >= 0 && correct < 4;
  });
}

/**
 * Parse one LLM reply into a valid pack or null. Strips a single ```json
 * fence when the model wraps its answer despite being told not to.
 */
export function parseTriviaPackReply(text: string): ServerTriviaQuestion[] | null {
  try {
    const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed: unknown = JSON.parse(fenced);
    return isValidTriviaPack(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
