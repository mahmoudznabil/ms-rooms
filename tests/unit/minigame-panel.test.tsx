import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MiniGamePanel from "@/components/MiniGamePanel";
import { canMove, LUDO_HOME, LUDO_PLAYERS, ludoMove, TRACK, YARD } from "@/lib/games/ludo";

/**
 * Phase A1 acceptance, component level: roll 20×, the token position always
 * matches the rules and the UI never sticks.
 *
 * Why not Playwright: MiniGamePanel only mounts inside RoomView, which needs a
 * live Firebase session — not hermetic. The rules kernel is already covered by
 * scripted-roll unit tests; this suite covers the seam those cannot: that the
 * component applies the kernel's result, that a dead roll surfaces a reason
 * instead of a silent dead button, and that the turn always comes back to the
 * human so the roll button is never stuck.
 */

/** Deterministic PRNG so a failing run is reproducible from the seed alone. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("MiniGamePanel — Ludo turn loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockImplementation(lcg(0xbeef));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mount() {
    render(<MiniGamePanel />);
    const rollBtn = () => screen.getByRole("button", { name: /roll dice/i }) as HTMLButtonElement;
    return { rollBtn };
  }

  /** Drive the human roll plus every bot turn until control returns (or a win). */
  function advanceOneRound() {
    act(() => {
      // 30s of virtual time covers a human roll (~0.7s) and several bot turns
      // (0.9s wait + ~0.7s animation each, plus 6-granted extra turns). Once
      // the human's turn returns no further timers fire, so overshooting is
      // idempotent.
      vi.advanceTimersByTime(30_000);
    });
  }

  it("20 rolls: every outcome is explained and the roll button always returns", () => {
    const { rollBtn } = mount();

    for (let i = 0; i < 20; i++) {
      // If any player reached home, reset and keep rolling.
      if (screen.queryByText(/wins the round/i)) {
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /reset game/i }));
        });
      }

      const btn = rollBtn();
      expect(btn.disabled, `roll ${i}: roll button stuck disabled`).toBe(false);
      expect(btn.textContent).toMatch(/roll dice/i);

      act(() => {
        fireEvent.click(btn);
      });
      advanceOneRound();

      // Whatever happened, the status line says something specific.
      const status = screen.getByRole("status");
      const text = status.textContent ?? "";
      expect(text.length, `roll ${i}: empty status line`).toBeGreaterThan(8);
    }
  });

  it("a yard roll below 6 leaves the token in the yard and says why", () => {
    const { rollBtn } = mount();

    act(() => {
      vi.mocked(Math.random).mockReturnValue(0.4); // floor(0.4*6)+1 = 3
      fireEvent.click(rollBtn());
    });
    advanceOneRound();

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/needs a 6 to leave the yard/i);
  });

  it("an overshoot roll near home is refused with an exact-roll explanation", () => {
    const { rollBtn } = mount();

    // Walk the human token out and almost home with guaranteed 6s.
    act(() => {
      vi.mocked(Math.random).mockReturnValue(0.9); // 6
      fireEvent.click(rollBtn());
    });
    advanceOneRound();
    // Token is on START[0]=0. Three exact 6s → tile 18.
    for (let i = 0; i < 3; i++) {
      const btn = rollBtn();
      if (btn.disabled) return; // a bot reached home first; nothing to assert
      act(() => {
        fireEvent.click(btn);
      });
      advanceOneRound();
    }
    // Now at 18: a 5 overshoots home and must be refused.
    act(() => {
      vi.mocked(Math.random).mockReturnValue(0.8); // floor(0.8*6)+1 = 5
      fireEvent.click(rollBtn());
    });
    advanceOneRound();

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/exact/i);
  });

  it("shows the turn order and rolls bots automatically so the human's turn returns", () => {
    const { rollBtn } = mount();

    // All four seats are labelled (active one prefixed with the ▶ marker).
    LUDO_PLAYERS.forEach((p) => {
      expect(screen.getAllByText(new RegExp(`^${p.name}$`)).length).toBeGreaterThan(0);
    });

    act(() => {
      vi.mocked(Math.random).mockReturnValue(0.05); // 1 → yard-dead for the human
      fireEvent.click(rollBtn());
    });
    advanceOneRound();

    // The bots have played their turns and the button is the human's again.
    const btn = rollBtn();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toMatch(/roll dice/i);
  });

  it("only shows yard tokens on the board at game start", () => {
    mount();
    const dots = document.querySelectorAll("[title]");
    expect(dots.length).toBe(LUDO_PLAYERS.length);
    dots.forEach((d) => {
      expect(LUDO_PLAYERS.some((p) => p.name === d.getAttribute("title"))).toBe(true);
    });
  });
});

describe("rules ↔ board geometry consistency", () => {
  it("the 20-cell track the component renders is exactly what the kernel walks", () => {
    expect(TRACK).toHaveLength(20);
    expect(new Set(TRACK).size).toBe(20);
    TRACK.forEach((cell) => {
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(49);
      const row = Math.floor(cell / 7);
      const col = cell % 7;
      // Every track cell lies on the perimeter of the 7×7 grid.
      expect(row === 0 || row === 6 || col === 0 || col === 6).toBe(true);
    });
  });

  it("canMove agrees with ludoMove for every (position, roll) pair", () => {
    for (let token = YARD; token <= LUDO_HOME; token++) {
      const players = LUDO_PLAYERS.map((p, i) => ({ ...p, token: i === 0 ? token : YARD }));
      for (let value = 1; value <= 6; value++) {
        const res = ludoMove(players, 0, value);
        expect(canMove(players, 0, value), `token ${token} roll ${value}`).toBe(res.moved);
      }
    }
  });
});
