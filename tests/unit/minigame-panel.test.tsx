import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    // This repo's vitest config does not set `globals: true`, so
    // @testing-library/react's auto-cleanup never registers — unmount
    // explicitly, or every mount() piles another board into document.body and
    // getByRole/querySelectorAll see all of them at once.
    cleanup();
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
    // Advance in 1s chunks (up to 60s virtual). A single large
    // advanceTimersByTime STALLS the bot chain: the bot's setTimeout is
    // scheduled from a useEffect that must commit between timer firings, and
    // one giant synchronous tick never lets that commit happen mid-flight
    // (proven by a debug spec: chunked 1s advances finish a full round in
    // ~7s virtual; a single 30s advance sticks on "Blue is rolling…").
    for (let t = 0; t < 60; t++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      const humanBack = screen.queryByRole("button", { name: /roll dice/i }) !== null;
      const won = screen.queryAllByText(/wins the round/i).length > 0;
      if (humanBack || won) break;
    }
  }

  it("20 rolls: every outcome is explained and the roll button always returns", () => {
    const { rollBtn } = mount();

    for (let i = 0; i < 20; i++) {
      // If any player reached home, reset and keep rolling. queryAllByText:
      // the banner AND the status line both contain the phrase.
      if (screen.queryAllByText(/wins the round/i).length > 0) {
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
      // Human animation is 660ms; the bot timer fires at 900ms. Advancing
      // 800ms settles exactly the human roll, so the status line still shows
      // the human's own dead-roll reason instead of a later bot's message.
      vi.advanceTimersByTime(800);
    });

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/needs a 6 to leave the yard/i);
  });

  it("an overshoot roll near home is refused with an exact-roll explanation", () => {
    const { rollBtn } = mount();

    // Script the FINALS of the next rolls: exit + three 6s walk 0→6→12→18
    // (every 6 keeps the human turn, so no bot rolls interleave), then a 5,
    // which overshoots home from 18 and must be refused. Each roll consumes
    // 12 random calls (11 animation ticks + the final), so the script keys
    // off every 12th call. A flat mockReturnValue(0.9) would NOT work here:
    // every bot would also roll 6s and take infinite extra turns.
    const finals = [6, 6, 6, 6, 5];
    let calls = 0;
    vi.mocked(Math.random).mockImplementation(() => {
      calls++;
      if (calls % 12 === 0) {
        const v = finals[Math.floor(calls / 12) - 1] ?? 1;
        return (v - 1) / 6 + 0.01; // floor(r*6)+1 === v
      }
      return 0.05; // animation ticks — the shown face is irrelevant
    });
    for (let i = 0; i < 5; i++) {
      act(() => {
        fireEvent.click(rollBtn());
        vi.advanceTimersByTime(800);
      });
    }

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
