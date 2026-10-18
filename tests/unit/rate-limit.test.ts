import { describe, it, expect } from "vitest";
import { ratePolicyFor, isOverLimit, WINDOW_MS } from "../../workers/rate-limit";

describe("ratePolicyFor — value endpoints", () => {
  it("bounds the XP faucet far below the generic write default", () => {
    // The handler caps the amount per call but not the number of calls, so an
    // unbounded count was possible. This is the single most important entry.
    const xp = ratePolicyFor("/api/xp/award", "POST");
    const generic = ratePolicyFor("/api/some/unknown/write", "POST");
    expect(xp.limit).toBe(20);
    expect(xp.limit!).toBeLessThan(generic.limit!);
  });

  it("keeps a retry after a dropped connection possible on once-a-day endpoints", () => {
    // A limit of 1 would punish a flaky mobile network. 10 still absorbs several
    // retries while stopping a loop.
    expect(ratePolicyFor("/api/checkin", "POST").limit).toBeGreaterThanOrEqual(5);
  });

  it("allows a burst of gifts without tripping", () => {
    expect(ratePolicyFor("/api/gifts/send", "POST").limit).toBe(60);
  });

  it("bounds paid-storage uploads", () => {
    expect(ratePolicyFor("/api/attachments/upload", "POST").limit).toBe(20);
  });

  it("bounds recharge requests that create manual admin work", () => {
    expect(ratePolicyFor("/api/recharge/request", "POST").limit).toBe(10);
  });
});

describe("ratePolicyFor — precedence", () => {
  it("matches a specific path before a prefix that would also match", () => {
    // /api/games/start and /api/games/finish are both listed; if a broader
    // /api/games prefix were added first it would shadow them silently.
    expect(ratePolicyFor("/api/games/start", "POST").limit).toBe(30);
    expect(ratePolicyFor("/api/games/finish", "POST").limit).toBe(30);
  });

  it("keeps admin limits tight even though /api/admin is a prefix", () => {
    expect(ratePolicyFor("/api/admin/users/ban", "POST").limit).toBe(30);
  });

  it("gives every limit a stated reason", () => {
    const paths = [
      "/api/xp/award",
      "/api/checkin",
      "/api/gifts/send",
      "/api/attachments/upload",
      "/api/admin/users",
      "/api/signal/poll",
    ];
    for (const p of paths) {
      expect(ratePolicyFor(p, "POST").why.length).toBeGreaterThan(10);
    }
  });
});

describe("ratePolicyFor — what is unlimited", () => {
  it("does not limit ordinary page reads", () => {
    // Throttling these produces a broken UI rather than a defence.
    expect(ratePolicyFor("/api/rooms", "GET").limit).toBeNull();
    expect(ratePolicyFor("/api/conversations", "GET").limit).toBeNull();
    expect(ratePolicyFor("/api/search", "GET").limit).toBeNull();
  });

  it("limits only polled reads among safe methods", () => {
    expect(ratePolicyFor("/api/signal/poll", "GET").limit).toBe(120);
  });

  it("does not limit HEAD or OPTIONS", () => {
    expect(ratePolicyFor("/api/rooms", "HEAD").limit).toBeNull();
    expect(ratePolicyFor("/api/rooms", "OPTIONS").limit).toBeNull();
  });

  it("is case-insensitive about the method", () => {
    expect(ratePolicyFor("/api/rooms", "get").limit).toBeNull();
  });

  it("applies the write default to an unlisted state-changing route", () => {
    expect(ratePolicyFor("/api/brand/new/thing", "POST").limit).toBe(100);
  });
});

describe("isOverLimit", () => {
  const t0 = 1_000_000;

  it("counts the current request toward the limit", () => {
    // Semantics: `kept` is the traffic already in the window, and the request
    // being judged is kept.length + 1. So a limit of 5 admits the 1st..5th and
    // rejects the 6th.
    const limit = 5;
    const four = Array.from({ length: limit - 1 }, (_, i) => t0 + i);
    expect(isOverLimit(four, t0 + 100, limit).limited).toBe(false);

    const five = Array.from({ length: limit }, (_, i) => t0 + i);
    expect(isOverLimit(five, t0 + 100, limit).limited).toBe(true);
  });

  it("forgets timestamps older than the window", () => {
    // One hit from 61s ago, limit 1: the stale one must not count, so the
    // current request is only the 1st in the window and passes.
    const stale = t0 - WINDOW_MS - 1;
    expect(isOverLimit([stale], t0, 1).limited).toBe(false);
  });

  it("counts only hits inside the window", () => {
    const hits = [t0 - 59_000, t0 - 58_000, t0 - 1];
    // 3 in-window hits + this one = 4, over a limit of 3 but not over 4.
    expect(isOverLimit(hits, t0, 3).limited).toBe(true);
    expect(isOverLimit(hits, t0, 4).limited).toBe(false);
  });

  it("returns the pruned list so the caller can store it back", () => {
    const hits = [t0 - WINDOW_MS - 1, t0 - 1000];
    const r = isOverLimit(hits, t0, 10);
    expect(r.kept).toEqual([t0 - 1000]);
  });

  it("never mutates the array it was given", () => {
    const hits = [t0 - WINDOW_MS - 1, t0 - 1000];
    isOverLimit(hits, t0, 10);
    expect(hits.length).toBe(2);
  });

  it("blocks a sustained flood at the real XP limit", () => {
    const limit = ratePolicyFor("/api/xp/award", "POST").limit!;
    const flood = Array.from({ length: 500 }, (_, i) => t0 + i * 100);
    expect(isOverLimit(flood, t0 + 49_900, limit).limited).toBe(true);
  });
});
