import { describe, expect, it } from "vitest";
import {
  PRIVATE_CALL_CAPACITY,
  ROOM_CAPACITY_DEFAULT,
  ROOM_CAPACITY_MAX,
  roomSeatPolicy,
  seatExists,
  seatRefusalReason,
} from "@/workers/room-policy";

/**
 * Room policy wins.
 *
 * These cases pin two bugs that shipped before this module existed, both of
 * which failed silently:
 *
 *   1. Seat handlers hardcoded `seatIndex > 7`, so a room configured for 12
 *      seats could never be filled past the eighth — the UI drew twelve seats
 *      and the last four did nothing.
 *   2. The same hardcoded bound ignored `rooms.capacity` entirely, so a
 *      private 1-on-1 call (2 seats) would have accepted eight people into a
 *      session the host is being billed for.
 */

describe("roomSeatPolicy — the room decides", () => {
  it("honours a capacity-12 room all the way to the last seat", () => {
    const p = roomSeatPolicy({ capacity: 12, is_private: 0 });
    expect(p.capacity).toBe(12);
    // The exact regression: seat 11 used to be rejected by the hardcoded bound.
    expect(seatExists(p, 11)).toBe(true);
    expect(seatExists(p, 12)).toBe(false);
  });

  it("honours a capacity-4 room and refuses seat 4", () => {
    const p = roomSeatPolicy({ capacity: 4, is_private: 0 });
    expect(p.capacity).toBe(4);
    expect(seatExists(p, 3)).toBe(true);
    expect(seatExists(p, 4)).toBe(false);
  });

  it("defaults to 8 when the room states nothing usable", () => {
    for (const room of [{}, { capacity: null }, { capacity: "abc" }, { capacity: NaN }]) {
      const p = roomSeatPolicy(room);
      expect(p.capacity).toBe(ROOM_CAPACITY_DEFAULT);
      expect(p.usedDefault).toBe(true);
    }
  });

  it("does not snap an unusual but valid capacity", () => {
    // A 3-seat panel is a real configuration. Rounding it to 4 would silently
    // admit someone the room owner did not offer a seat to.
    const p = roomSeatPolicy({ capacity: 3, is_private: 0 });
    expect(p.capacity).toBe(3);
    expect(seatExists(p, 2)).toBe(true);
    expect(seatExists(p, 3)).toBe(false);
  });

  it("clamps a capacity above what the seats table can represent", () => {
    const p = roomSeatPolicy({ capacity: 500, is_private: 0 });
    expect(p.capacity).toBe(ROOM_CAPACITY_MAX);
  });

  it("treats a zero or negative capacity as unset rather than a room with no seats", () => {
    for (const capacity of [0, -4]) {
      const p = roomSeatPolicy({ capacity, is_private: 0 });
      expect(p.capacity).toBe(ROOM_CAPACITY_DEFAULT);
    }
  });

  it("survives a missing room row", () => {
    expect(roomSeatPolicy(null).capacity).toBe(ROOM_CAPACITY_DEFAULT);
    expect(roomSeatPolicy(undefined).capacity).toBe(ROOM_CAPACITY_DEFAULT);
  });
});

describe("roomSeatPolicy — private calls are always two seats", () => {
  it("pins a private call to two seats even if capacity says otherwise", () => {
    const p = roomSeatPolicy({ capacity: 12, is_private: 1 });
    expect(p.capacity).toBe(PRIVATE_CALL_CAPACITY);
    expect(p.privateCall).toBe(true);
    // Host (seat 0) and the invited participant (seat 1) only.
    expect(seatExists(p, 1)).toBe(true);
    expect(seatExists(p, 2)).toBe(false);
  });

  it("does not let a stale capacity of 8 turn a private call into a party", () => {
    const p = roomSeatPolicy({ capacity: 8, is_private: true });
    expect(p.capacity).toBe(2);
  });

  it("recognises the flag however D1 hands it back", () => {
    for (const is_private of [1, true, "1"]) {
      expect(roomSeatPolicy({ capacity: 12, is_private }).capacity).toBe(2);
    }
    for (const is_private of [0, false, "0", null, undefined]) {
      expect(roomSeatPolicy({ capacity: 12, is_private }).capacity).toBe(12);
    }
  });

  it("explains the refusal differently from an ordinary room", () => {
    expect(seatRefusalReason(roomSeatPolicy({ is_private: 1 }))).toMatch(/private call/i);
    expect(seatRefusalReason(roomSeatPolicy({ capacity: 12, is_private: 0 }))).toMatch(
      /seats 12/
    );
  });
});

describe("seatExists — bounds", () => {
  const p = roomSeatPolicy({ capacity: 8, is_private: 0 });

  it("rejects non-integer and negative indices", () => {
    for (const i of [1.5, -1, NaN, Infinity]) {
      expect(seatExists(p, i)).toBe(false);
    }
  });

  it("accepts every seat inside the room and refuses the first one past it", () => {
    for (let i = 0; i < 8; i++) expect(seatExists(p, i)).toBe(true);
    expect(seatExists(p, 8)).toBe(false);
  });
});