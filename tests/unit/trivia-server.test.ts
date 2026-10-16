import { describe, expect, it } from "vitest";
import { isValidTriviaPack, parseTriviaPackReply } from "@/workers/trivia-validate";

/**
 * Phase B: the server-side trivia contract. The questions come from an LLM,
 * so the validator is the load-bearing wall — a malformed pack must never be
 * stored (`POST /api/admin/trivia/generate`) nor served
 * (`GET /api/trivia/pack`), and the client must always have a static pool to
 * fall back to.
 */

function goodQuestion(overrides: Record<string, unknown> = {}) {
  return {
    q: "What is the capital of France?",
    options: ["London", "Paris", "Berlin", "Madrid"],
    correct: 1,
    ...overrides,
  };
}

function goodPack() {
  return [
    goodQuestion(),
    goodQuestion({ q: "Red planet?", options: ["Venus", "Jupiter", "Mars", "Saturn"], correct: 2 }),
    goodQuestion({ q: "H2O?", options: ["Salt", "Sugar", "Water", "Oxygen"], correct: 2 }),
    goodQuestion({ q: "Leap year days?", options: ["364", "365", "366", "367"], correct: 2 }),
    goodQuestion({ q: "Largest ocean?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3 }),
  ];
}

describe("isValidTriviaPack", () => {
  it("accepts a well-formed 5-question pack", () => {
    expect(isValidTriviaPack(goodPack())).toBe(true);
  });

  it.each([
    ["empty array", []],
    ["4 questions", goodPack().slice(0, 4)],
    ["6 questions", [...goodPack(), goodQuestion()]],
    ["not an array", { questions: goodPack() }],
    ["null", null],
    ["a string", "nope"],
  ])("rejects %s", (_label, pack) => {
    expect(isValidTriviaPack(pack)).toBe(false);
  });

  it.each([
    ["empty question text", { q: "  " }],
    ["missing options", { options: undefined }],
    ["3 options", { options: ["a", "b", "c"] }],
    ["5 options", { options: ["a", "b", "c", "d", "e"] }],
    ["duplicate options", { options: ["a", "a", "b", "c"] }],
    ["empty option", { options: ["a", "", "b", "c"] }],
    ["non-string option", { options: ["a", 1, "b", "c"] }],
    ["correct out of range", { correct: 4 }],
    ["negative correct", { correct: -1 }],
    ["non-integer correct", { correct: 1.5 }],
    ["missing correct", { correct: undefined }],
    ["null entry", null],
  ])("rejects a pack containing %s", (_label, override) => {
    const pack = goodPack();
    if (override === null) {
      pack[2] = null as unknown as ReturnType<typeof goodQuestion>;
    } else {
      pack[2] = goodQuestion(override as Record<string, unknown>);
    }
    expect(isValidTriviaPack(pack)).toBe(false);
  });
});

describe("parseTriviaPackReply", () => {
  it("parses a bare JSON array reply", () => {
    expect(parseTriviaPackReply(JSON.stringify(goodPack()))).toEqual(goodPack());
  });

  it("strips one ```json fence when the model wraps its answer", () => {
    const fenced = "```json\n" + JSON.stringify(goodPack()) + "\n```";
    expect(parseTriviaPackReply(fenced)).toEqual(goodPack());
  });

  it("returns null for prose, truncated JSON, and valid-JSON-wrong-shape", () => {
    expect(parseTriviaPackReply("Here are your questions: ...")).toBe(null);
    expect(parseTriviaPackReply(JSON.stringify(goodPack()).slice(0, 40))).toBe(null);
    expect(parseTriviaPackReply(JSON.stringify({ questions: goodPack() }))).toBe(null);
    expect(parseTriviaPackReply(JSON.stringify(goodPack().slice(0, 3)))).toBe(null);
  });
});
