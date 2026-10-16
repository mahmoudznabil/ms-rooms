/**
 * Ludo rules kernel — pure functions, no React, no DOM.
 *
 * Extracted from MiniGamePanel because the inline implementation had two real
 * defects: it called a state setter *inside* a state updater (side effect in an
 * updater — double-fires under StrictMode, reads a stale turn closure), and it
 * gave the user zero feedback when a roll could not move the token, which made
 * a legal "need a 6" turn look like a broken die.
 *
 * Board geometry: a 7x7 grid whose perimeter is the shared track, the four
 * corners are private yards, the middle 3x3 is home. The track is a clockwise
 * ring of 20 tiles listed in walking order, so a token position is just an
 * index into it. Four colours share it, spaced five tiles apart.
 *
 * Rules (single token per player):
 * - A token starts in the yard at -1. Only a 6 releases it onto its start tile.
 * - A 6 grants an extra turn (classic Ludo).
 * - Landing exactly on home (index LUDO_HOME) finishes the token.
 * - An overshoot roll is refused — home needs an exact roll.
 * - Landing on a tile occupied by an opponent sends that opponent back to the
 *   yard and grants an extra turn.
 */

export const GRID = 7;

/** Clockwise ring of 20 tiles in walking order (corners are yards, skipped). */
export const TRACK: number[] = [
  1, 2, 3, 4, 5,        // top edge, left -> right
  13, 20, 27, 34, 41,   // right edge, top -> bottom
  47, 46, 45, 44, 43,   // bottom edge, right -> left
  35, 28, 21, 14, 7,    // left edge, bottom -> top
];

/** Yard cells: top-left, top-right, bottom-right, bottom-left. */
export const YARDS = [0, 6, 42, 48];

/** Each colour's entry tile on TRACK. */
export const START = [0, 5, 10, 15];

export const YARD = -1;
export const TRACK_LENGTH = TRACK.length; // 20
/** A token here has walked the whole track and finished. */
export const LUDO_HOME = TRACK_LENGTH;

export interface LudoPlayer {
  name: string;
  /** Token colour class, also used for its yard. */
  bg: string;
  /** -1 = yard, 0..19 = index into TRACK, LUDO_HOME = home. */
  token: number;
}

export interface LudoMoveResult {
  players: LudoPlayer[];
  /** Whose turn is next (0-based). */
  nextPlayer: number;
  /** Human-readable outcome, shown under the board. */
  message: string;
  /** True when the mover keeps the turn (a 6, a capture, or a home landing). */
  extraTurn: boolean;
  /** Indices of players whose token was captured back to the yard. */
  captured: number[];
  /** False when the roll could not be applied (dead roll). */
  moved: boolean;
}

export const LUDO_PLAYERS: LudoPlayer[] = [
  { name: "You", bg: "bg-rose-400", token: YARD },
  { name: "Blue", bg: "bg-sky-400", token: YARD },
  { name: "Green", bg: "bg-emerald-400", token: YARD },
  { name: "Gold", bg: "bg-amber-400", token: YARD },
];

export function clonePlayers(players: LudoPlayer[]): LudoPlayer[] {
  return players.map((p) => ({ ...p }));
}

/**
 * Can this player's token legally advance by `value`?
 * Used to highlight/disable the roll button and to explain dead rolls.
 */
export function canMove(players: LudoPlayer[], player: number, value: number): boolean {
  const token = players[player]?.token ?? YARD;
  if (token >= LUDO_HOME) return false;       // already finished
  if (token === YARD) return value === 6;     // leaving the yard needs an exact 6
  return token + value <= LUDO_HOME;          // home needs an exact roll
}

/**
 * Apply one die roll for `player`. Pure: returns a new state plus the message
 * and turn decision. Never mutates the input.
 */
export function ludoMove(players: LudoPlayer[], player: number, value: number): LudoMoveResult {
  const next = clonePlayers(players);
  const mover = next[player];
  const name = mover?.name ?? "Player";

  if (!mover || value < 1 || value > 6) {
    return { players: next, nextPlayer: (player + 1) % next.length, message: "Invalid roll.", extraTurn: false, captured: [], moved: false };
  }

  // Already home: turn passes.
  if (mover.token >= LUDO_HOME) {
    return {
      players: next,
      nextPlayer: (player + 1) % next.length,
      message: `${name} is already home.`,
      extraTurn: false,
      captured: [],
      moved: false,
    };
  }

  // Leaving the yard needs an exact 6 — and that is the rule players miss, so
  // the message has to say it out loud instead of silently passing the turn.
  if (mover.token === YARD) {
    if (value !== 6) {
      return {
        players: next,
        nextPlayer: (player + 1) % next.length,
        message: `${name} needs a 6 to leave the yard.`,
        extraTurn: false,
        captured: [],
        moved: false,
      };
    }
    mover.token = START[player];
    return {
      players: next,
      nextPlayer: player, // a 6 grants an extra turn
      message: `${name} brought a token out of the yard — roll again!`,
      extraTurn: true,
      captured: [],
      moved: true,
    };
  }

  // On the track.
  const landing = mover.token + value;

  // Home needs an exact roll; an overshoot stays put.
  if (landing > LUDO_HOME) {
    return {
      players: next,
      nextPlayer: (player + 1) % next.length,
      message: `${name} needs an exact ${LUDO_HOME - mover.token} to reach home — rolled ${value}, staying put.`,
      extraTurn: false,
      captured: [],
      moved: false,
    };
  }

  mover.token = landing;

  // Capture: anyone else standing on the landing tile goes back to the yard.
  const captured: number[] = [];
  next.forEach((op, i) => {
    if (i !== player && op.token === landing) {
      op.token = YARD;
      captured.push(i);
    }
  });

  if (landing === LUDO_HOME) {
    return {
      players: next,
      nextPlayer: player,
      message: `${name} reached home! 🏁`,
      extraTurn: true,
      captured,
      moved: true,
    };
  }

  if (captured.length > 0) {
    const victims = captured.map((i) => next[i].name).join(" and ");
    return {
      players: next,
      nextPlayer: player, // a capture grants an extra turn
      message: `${name} sent ${victims} back to the yard — roll again!`,
      extraTurn: true,
      captured,
      moved: true,
    };
  }

  // A plain track move. Rolling a 6 keeps the turn (classic Ludo) — the yard
  // exit is not special here; the extra turn belongs to the die face.
  const rolledSix = value === 6;
  return {
    players: next,
    nextPlayer: rolledSix ? player : (player + 1) % next.length,
    message: rolledSix
      ? `${name} moved to tile ${landing + 1} — a 6, roll again!`
      : `${name} moved to tile ${landing + 1}.`,
    extraTurn: rolledSix,
    captured: [],
    moved: true,
  };
}
