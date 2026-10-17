/**
 * Room seat policy — pure functions, no DB, no I/O.
 *
 * THE RULE: the ROOM decides how many seats it has. Nothing else may override
 * that, and nothing may silently disagree with it.
 *
 * This exists because it did not. Seat endpoints used to reject any
 * `seatIndex > 7`, hardcoded in the handler. That constant was invisible, it
 * had no relationship to `rooms.capacity`, and the two disagreed without
 * anyone being told:
 *
 *   - A room created with capacity 12 drew twelve seats in the UI, and every
 *     seat past the eighth was permanently unreachable.
 *   - A private 1-on-1 call room (capacity 2) would have accepted eight people.
 *
 * Neither produced an error. Both were just quietly wrong, and the only place
 * the real rule lived was a literal `7` buried in two request handlers.
 *
 * So the rule lives here, is stated once, and is unit-tested.
 *
 * THE PRIVATE-CALL INVARIANT. A private call is billed per minute to a
 * specific invited participant. Admitting a third person would put an
 * unbilled stranger into a paid session and change what the host is being
 * charged for, so a private call is exactly TWO seats regardless of what the
 * stored capacity column says. That limit is an invariant, not a preference,
 * which is why it overrides the column rather than being normalised with it.
 */

/** Smallest seat count a room may declare. */
export const ROOM_CAPACITY_MIN = 1;

/**
 * Largest seat count the product supports. The `seats` table's own CHECK
 * constraint is `seat_index BETWEEN 0 AND 11` (12 seats) — see
 * `migrations/0001_init.sql`. This mirrors it so a bad row cannot ask for more
 * seats than the schema can represent.
 */
export const ROOM_CAPACITY_MAX = 12;

/** Seat count used when the room states no usable capacity. */
export const ROOM_CAPACITY_DEFAULT = 8;

/** A private paid call seats exactly the host and the invited participant. */
export const PRIVATE_CALL_CAPACITY = 2;

/** The minimum shape needed to decide a room's seat count. */
export interface RoomSeatSource {
  capacity?: unknown;
  is_private?: unknown;
}

export interface RoomSeatPolicy {
  /** How many seats (indices 0..capacity-1) exist in this room. */
  capacity: number;
  /** True when PRIVATE_CALL_CAPACITY overrides the stored capacity column. */
  privateCall: boolean;
  /** True when the stored capacity was unusable and the default was applied. */
  usedDefault: boolean;
}

function truthyFlag(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

/**
 * The room's seat count.
 *
 * A private call is always exactly two seats. Otherwise the stored capacity is
 * honoured as written — this is deliberately NOT snapped to a set of "nice"
 * sizes, because rooms legitimately hold unusual capacities (a 2-seat private
 * call, a 3-seat panel) and rounding them would silently change who can join.
 * Values outside what the schema can represent are clamped to the bounds
 * rather than replaced, so a room that asks for 500 seats is corrected to 12
 * instead of being rewritten to a size nobody chose.
 */
export function roomSeatPolicy(room: RoomSeatSource | null | undefined): RoomSeatPolicy {
  if (!room) {
    return { capacity: ROOM_CAPACITY_DEFAULT, privateCall: false, usedDefault: true };
  }

  if (truthyFlag(room.is_private)) {
    return { capacity: PRIVATE_CALL_CAPACITY, privateCall: true, usedDefault: false };
  }

  const raw = Number(room.capacity);
  if (!Number.isFinite(raw)) {
    return { capacity: ROOM_CAPACITY_DEFAULT, privateCall: false, usedDefault: true };
  }

  const truncated = Math.trunc(raw);
  if (truncated < ROOM_CAPACITY_MIN) {
    return { capacity: ROOM_CAPACITY_DEFAULT, privateCall: false, usedDefault: true };
  }
  if (truncated > ROOM_CAPACITY_MAX) {
    return { capacity: ROOM_CAPACITY_MAX, privateCall: false, usedDefault: false };
  }
  return { capacity: truncated, privateCall: false, usedDefault: false };
}

/** Is this seat index a seat that exists in this room? */
export function seatExists(policy: RoomSeatPolicy, seatIndex: number): boolean {
  return Number.isInteger(seatIndex) && seatIndex >= 0 && seatIndex < policy.capacity;
}

/** Operator-facing explanation of why a seat was refused. */
export function seatRefusalReason(policy: RoomSeatPolicy): string {
  return policy.privateCall
    ? "This is a private call — it seats the host and one guest."
    : `This room seats ${policy.capacity}.`;
}