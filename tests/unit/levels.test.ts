import { describe, expect, it } from "vitest";
import {
  formatCount,
  GIFT_CATALOG,
} from "@/lib/rooms";
import {
  getLevelInfo,
  levelForXp,
  levelProgress,
  tierForLevel,
} from "@/lib/levels";

/**
 * Pin the XP → level curve and the lobby formatters.
 *
 * These are pure, already-working modules. They are the first suites because
 * they prove the harness runs end to end (resolution of `@/`, jsdom, TS) while
 * also locking in boundary behaviour that a future refactor could silently
 * break — level thresholds are user-visible and economy-adjacent.
 */

describe("XP level curve", () => {
  it("starts a brand-new account at level 1 with no XP", () => {
    const info = getLevelInfo(0);
    expect(info.level).toBe(1);
    expect(info.nextXp).toBe(200);
    expect(info.progress).toBe(0);
  });

  it("holds the lower tier exactly at the threshold boundary", () => {
    // 199 is still level 1; 200 tips over. Off-by-one here mislabels every
    // user sitting on a boundary.
    expect(levelForXp(199)).toBe(1);
    expect(levelForXp(200)).toBe(2);
  });

  it("clamps negative XP to zero instead of producing a phantom tier", () => {
    const info = getLevelInfo(-500);
    expect(info.level).toBe(1);
    expect(info.progress).toBe(0);
  });

  it("caps at the top tier and reports full progress, never a next level", () => {
    const info = getLevelInfo(80_000);
    expect(info.level).toBe(8);
    expect(info.nextXp).toBeNull();
    expect(info.progress).toBe(1);
  });

  it("reports progress as a 0..1 fraction within the current span", () => {
    // Level 2 spans 200..600; 400 is halfway.
    const info = getLevelInfo(400);
    expect(info.level).toBe(2);
    expect(info.progress).toBeCloseTo(0.5, 5);
  });
});

describe("levelProgress view model", () => {
  it("rounds percentage and exposes the next threshold", () => {
    const { level, target, pct } = levelProgress(400);
    expect(level).toBe(2);
    expect(target).toBe(600);
    expect(pct).toBe(50);
  });
});

describe("frame tier mapping", () => {
  it("escalates the frame style by level band", () => {
    expect(tierForLevel(1)).toBe("default");
    expect(tierForLevel(3)).toBe("glow");
    expect(tierForLevel(5)).toBe("neon");
    expect(tierForLevel(7)).toBe("gold");
    expect(tierForLevel(99)).toBe("gold");
  });
});

describe("lobby formatting", () => {
  it("abbreviates thousands and trims a trailing .0", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(12_000)).toBe("12k");
  });

  it("keeps every gift priced in positive, whole coins", () => {
    // The gift catalog is the economy's public price list; a zero/negative or
    // fractional cost would be a client-side exploit surface.
    expect(GIFT_CATALOG.length).toBeGreaterThan(0);
    for (const gift of GIFT_CATALOG) {
      expect(Number.isInteger(gift.cost)).toBe(true);
      expect(gift.cost).toBeGreaterThan(0);
    }
  });

  it("does not reuse gift ids", () => {
    const ids = GIFT_CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
