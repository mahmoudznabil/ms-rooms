import { describe, expect, it } from "vitest";
import {
  canMove,
  clonePlayers,
  LUDO_HOME,
  LUDO_PLAYERS,
  ludoMove,
  START,
  YARD,
  type LudoPlayer,
} from "@/lib/games/ludo";

/**
 * Phase A1: the Ludo rules kernel, extracted so it can be tested with scripted
 * (seeded) rolls instead of clicking a die in a browser.
 *
 * These are the cases the plan calls out: yard exit needs an exact 6, a yard
 * roll of 4 is a legal dead roll that must SAY SO, capture sends the opponent
 * home, home needs an exact roll, and an overshoot stays put.
 */

function board(tokens: number[]): LudoPlayer[] {
  const players = clonePlayers(LUDO_PLAYERS);
  tokens.forEach((t, i) => (players[i].token = t));
  return players;
}

describe("ludoMove — leaving the yard", () => {
  it("yard + 6 releases the token onto its own start tile", () => {
    const res = ludoMove(clonePlayers(LUDO_PLAYERS), 0, 6);
    expect(res.players[0].token).toBe(START[0]);
    expect(res.moved).toBe(true);
    expect(res.extraTurn).toBe(true); // a 6 grants another roll
    expect(res.nextPlayer).toBe(0);
    expect(res.message).toMatch(/roll again/i);
  });

  it.each([
    [1],
    [2],
    [3],
    [4],
    [5],
  ])("yard + %i is a dead roll that explains itself", (value) => {
    const res = ludoMove(clonePlayers(LUDO_PLAYERS), 2, value);
    expect(res.players[2].token).toBe(YARD);
    expect(res.moved).toBe(false);
    expect(res.extraTurn).toBe(false);
    expect(res.nextPlayer).toBe(3);
    expect(res.message).toMatch(/needs a 6/i);
  });

  it("honours which player's start tile is used", () => {
    const res = ludoMove(clonePlayers(LUDO_PLAYERS), 3, 6);
    expect(res.players[3].token).toBe(START[3]);
  });
});

describe("ludoMove — track movement", () => {
  it("advances the token by the rolled value and passes the turn", () => {
    const res = ludoMove(board([0, YARD, YARD, YARD]), 0, 4);
    expect(res.players[0].token).toBe(4);
    expect(res.nextPlayer).toBe(1);
    expect(res.extraTurn).toBe(false);
    expect(res.moved).toBe(true);
  });

  it("a 6 on the track keeps the turn; any other roll passes it", () => {
    const six = ludoMove(board([0, YARD, YARD, YARD]), 0, 6);
    expect(six.players[0].token).toBe(6);
    expect(six.moved).toBe(true);
    expect(six.extraTurn).toBe(true);
    expect(six.nextPlayer).toBe(0);
    expect(six.message).toMatch(/roll again/i);

    const four = ludoMove(board([0, YARD, YARD, YARD]), 0, 4);
    expect(four.players[0].token).toBe(4);
    expect(four.extraTurn).toBe(false);
    expect(four.nextPlayer).toBe(1);
  });

  it("never walks past home — a roll crossing the finish is refused", () => {
    // The token circles the ring exactly once; there is no wrap-around past
    // the 20th tile. 18 + 5 would be 23, so the roll must be refused.
    const res = ludoMove(board([18, YARD, YARD, YARD]), 0, 5);
    expect(res.players[0].token).toBe(18);
    expect(res.moved).toBe(false);
  });
});

describe("ludoMove — capture", () => {
  it("landing on an opponent sends it back to the yard and grants an extra turn", () => {
    const start = board([0, 5, YARD, YARD]); // Blue stands on tile 5
    const res = ludoMove(start, 0, 5);
    expect(res.players[0].token).toBe(5);
    expect(res.players[1].token).toBe(YARD);
    expect(res.captured).toEqual([1]);
    expect(res.extraTurn).toBe(true);
    expect(res.nextPlayer).toBe(0);
    expect(res.message).toMatch(/back to the yard/i);
    expect(res.moved).toBe(true);
  });

  it("does not capture itself when several players share the logic", () => {
    const start = board([0, 5, 5, YARD]);
    const res = ludoMove(start, 0, 5);
    expect(res.captured).toEqual([1, 2]);
    expect(res.players[2].token).toBe(YARD);
  });

  it("landing on an empty tile captures nobody", () => {
    const res = ludoMove(board([0, 5, YARD, YARD]), 0, 3);
    expect(res.captured).toEqual([]);
    expect(res.players[1].token).toBe(5);
  });
});

describe("ludoMove — reaching home", () => {
  it("an exact roll finishes the token", () => {
    const res = ludoMove(board([18, YARD, YARD, YARD]), 0, 2);
    expect(res.players[0].token).toBe(LUDO_HOME);
    expect(res.moved).toBe(true);
    expect(res.message).toMatch(/home/i);
  });

  it("an overshoot roll is refused and the token stays put", () => {
    const res = ludoMove(board([18, YARD, YARD, YARD]), 0, 5);
    expect(res.players[0].token).toBe(18);
    expect(res.moved).toBe(false);
    expect(res.nextPlayer).toBe(1);
    expect(res.message).toMatch(/exact/i);
  });

  it("a token already home never moves again", () => {
    const res = ludoMove(board([LUDO_HOME, YARD, YARD, YARD]), 0, 6);
    expect(res.players[0].token).toBe(LUDO_HOME);
    expect(res.moved).toBe(false);
    expect(res.nextPlayer).toBe(1);
  });
});

describe("canMove", () => {
  it("only a 6 frees a yard token", () => {
    const players = clonePlayers(LUDO_PLAYERS);
    expect(canMove(players, 0, 6)).toBe(true);
    expect(canMove(players, 0, 4)).toBe(false);
  });

  it("allows any roll that lands exactly on or before home", () => {
    const players = board([16, YARD, YARD, YARD]);
    expect(canMove(players, 0, 4)).toBe(true);
    expect(canMove(players, 0, 5)).toBe(false);
  });

  it("denies a finished token", () => {
    const players = board([LUDO_HOME, YARD, YARD, YARD]);
    expect(canMove(players, 0, 6)).toBe(false);
  });
});

describe("ludoMove — full scripted game stays legal", () => {
  it("20 deterministic rolls never produce an illegal token index", () => {
    // Tiny LCG so the sequence is reproducible without a dependency.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };

    let players = clonePlayers(LUDO_PLAYERS);
    let turn = 0;
    for (let i = 0; i < 20; i++) {
      const roll = (rand() % 6) + 1;
      const res = ludoMove(players, turn, roll);
      players = res.players;
      turn = res.extraTurn ? turn : res.nextPlayer;

      players.forEach((p) => {
        expect(p.token).toBeGreaterThanOrEqual(YARD);
        expect(p.token).toBeLessThanOrEqual(LUDO_HOME);
      });
      expect(turn).toBeGreaterThanOrEqual(0);
      expect(turn).toBeLessThan(4);
      expect(res.message.length).toBeGreaterThan(0);
    }
  });
});
