import { describe, expect, it } from "vitest";
import {
  buildTriviaDeck,
  TRIVIA_POOL,
  TRIVIA_ROUND,
  type TriviaQuestion,
} from "@/lib/games/trivia-pack";

/**
 * Phase A2: the static trivia fallback is a real pool (60 questions) and deals
 * full rounds without repeats. Phase B adds the server pack; this module is
 * the guaranteed-offline deck, so it has to hold up on its own.
 */

describe("TRIVIA_POOL", () => {
  it("has at least 60 questions", () => {
    expect(TRIVIA_POOL.length).toBeGreaterThanOrEqual(60);
  });

  it("never repeats a question", () => {
    const questions = TRIVIA_POOL.map((q) => q.q.trim().toLowerCase());
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("every question has exactly four unique options and a valid answer index", () => {
    TRIVIA_POOL.forEach((q) => {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(q.options.length);
      expect(q.q.length).toBeGreaterThan(0);
      q.options.forEach((o) => expect(o.length).toBeGreaterThan(0));
    });
  });

  it("keeps answers roughly evenly spread (no fixed correct index)", () => {
    const counts = [0, 0, 0, 0];
    TRIVIA_POOL.forEach((q) => (counts[q.correct] += 1));
    counts.forEach((c) => expect(c).toBeGreaterThan(0));
  });
});

describe("buildTriviaDeck", () => {
  it("deals a full round with no repeated questions", () => {
    const deck = buildTriviaDeck(TRIVIA_ROUND);
    expect(deck).toHaveLength(TRIVIA_ROUND);
    const keys = deck.map((q) => q.q);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("excludes questions already seen (previous deck)", () => {
    const first = buildTriviaDeck(TRIVIA_ROUND);
    const second = buildTriviaDeck(TRIVIA_ROUND, first.map((q) => q.q));
    const firstKeys = new Set(first.map((q) => q.q));
    second.forEach((q) => expect(firstKeys.has(q.q)).toBe(false));
  });

  it("returns only valid questions from the pool", () => {
    const pool = new Set(TRIVIA_POOL.map((q) => q.q));
    buildTriviaDeck(20).forEach((q: TriviaQuestion) => {
      expect(pool.has(q.q)).toBe(true);
      expect(q.options).toHaveLength(4);
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(4);
    });
  });

  it("caps the size at the pool length", () => {
    expect(buildTriviaDeck(10000)).toHaveLength(TRIVIA_POOL.length);
  });

  it("falls back to the full pool when exclusions cover too much", () => {
    const everything = TRIVIA_POOL.map((q) => q.q);
    const deck = buildTriviaDeck(5, everything);
    expect(deck).toHaveLength(5);
    // The exclusion list made `fresh` empty, so it dealt from the whole pool.
    deck.forEach((q) => expect(everything).toContain(q.q));
  });
});
