"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dices, Zap, Trophy, Target, Sparkles } from "lucide-react";
import {
  canMove,
  GRID,
  LUDO_HOME,
  LUDO_PLAYERS,
  ludoMove,
  TRACK,
  YARDS,
} from "@/lib/games/ludo";
import { buildTriviaDeck, TRIVIA_POOL, TRIVIA_ROUND, type TriviaQuestion } from "@/lib/games/trivia-pack";
import { fetchTriviaPack, finishGame, startGame } from "@/lib/api";

type GameType = "ludo" | "reaction" | "trivia" | "memory";

/** Server-side entry fee per game (mirrors GAME_ECON in workers/backend.ts). */
const GAME_FEE: Record<GameType, number> = { ludo: 5, reaction: 2, trivia: 5, memory: 2 };

/**
 * Mini games panel.
 *
 * The Ludo rules and the trivia pool both used to live inline here. They are
 * now pure modules (`lib/games/ludo.ts`, `lib/games/trivia-pack.ts`) so they
 * can be unit-tested with scripted rolls, and this component only owns UI
 * state, the dice animation and the local bot turns.
 *
 * Phase A1 fixes baked in:
 * - A dead roll (yard without a 6, overshoot before home) now SAYS WHY in the
 *   status line instead of silently passing the turn, which made the die look
 *   broken.
 * - The next player is computed OUTSIDE the state updater (`ludoMove` is pure)
 *   so no side effect fires inside an updater — that used to double-fire under
 *   StrictMode off a stale turn closure.
 * - The three non-human seats are bots that auto-roll on a short timer, with a
 *   visible turn order (You → Blue → Green → Gold), capture-back-to-yard, and
 *   an exact-roll-to-finish rule.
 */

interface MiniGamePanelProps {
  roomId?: string;
}

export default function MiniGamePanel({ roomId }: MiniGamePanelProps) {
  const [game, setGame] = useState<GameType>("ludo");
  const [dice, setDice] = useState(1);
  const [rolling, setRolling] = useState(false);
  const [score, setScore] = useState(0);
  const [reactionStart, setReactionStart] = useState<number | null>(null);
  const [reactionMsg, setReactionMsg] = useState("Tap Start, then tap as fast as you can when it turns green!");

  // --- Paid-session state (Phase A3) --------------------------------------
  // `sessionRef` holds the open server session id for the game currently being
  // played, so the finish handler can close it exactly once. `feeNotice`
  // surfaces the server's own message (insufficient coins, daily cap) in the
  // status line instead of a silent no-op.
  const sessionRef = useRef<string | null>(null);
  const [feeNotice, setFeeNotice] = useState<string | null>(null);

  // --- Ludo UI state --------------------------------------------------------
  const [ludo, setLudo] = useState(LUDO_PLAYERS);
  const [activeLudo, setNextLudo] = useState(0);
  const [ludoMsg, setLudoMsg] = useState("Roll a 6 to bring a token out of the yard.");
  const ludoRef = useRef(ludo);
  const activeLudoRef = useRef(activeLudo);
  useEffect(() => { ludoRef.current = ludo; }, [ludo]);
  useEffect(() => { activeLudoRef.current = activeLudo; }, [activeLudo]);

  const gameOver = ludo.some((p) => p.token >= LUDO_HOME);
  const gameOverRef = useRef(gameOver);
  useEffect(() => { gameOverRef.current = gameOver; }, [gameOver]);

  // Settle the paid Ludo round the moment a token reaches home. The winner's
  // name decides win/lose; the tally is the human's `score` so the server can
  // clamp it (ludo maxScore 5000) and ignore anything inflated. `settleRef`
  // keeps this effect from needing the handler in its dep list (the handler is
  // declared below, after the trivia/memory state it doesn't touch).
  const settleRef = useRef<(s: number) => void>(() => {});
  useEffect(() => {
    if (!gameOver) return;
    const winner = ludo.find((p) => p.token >= LUDO_HOME);
    settleRef.current(winner?.name === "You" ? score : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  // --- Trivia state (deck dealt from the 60-question pool, no repeats) ------
  const [triviaAnswer, setTriviaAnswer] = useState<number | null>(null);
  const [triviaDeck, setTriviaDeck] = useState<TriviaQuestion[]>([]);
  const [triviaPos, setTriviaPos] = useState(0);
  const [triviaScore, setTriviaScore] = useState(0);
  const [triviaSeen, setTriviaSeen] = useState<string[]>([]);

  const [memoryCards, setMemoryCards] = useState<number[]>([]);
  const [memoryFlipped, setMemoryFlipped] = useState<number[]>([]);
  const [memoryMatched, setMemoryMatched] = useState<number[]>([]);
  const [memoryMoves, setMemoryMoves] = useState(0);

  // Phase B: ask the server for a fresh AI pack first; fall back to the static
  // pool when none exists or the request fails. Server questions are shuffled
  // and filtered against already-seen ones so repeat visits still feel fresh.
  // `seenRef` mirrors `triviaSeen` so the async fetch never reads stale state.
  const triviaSeenRef = useRef<string[]>([]);
  useEffect(() => { triviaSeenRef.current = triviaSeen; }, [triviaSeen]);
  const loadTriviaDeck = useCallback(async () => {
    setTriviaPos(0);
    setTriviaScore(0);
    setTriviaAnswer(null);
    try {
      const pack = await fetchTriviaPack();
      if (pack) {
        const seen = new Set(triviaSeenRef.current);
        const fresh = pack.questions.filter((q) => !seen.has(q.q));
        const source = fresh.length > 0 ? fresh : pack.questions;
        const deck = [...source];
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        setTriviaDeck(deck.slice(0, Math.min(TRIVIA_ROUND, deck.length)));
        return;
      }
    } catch {
      // fall through to the static pool
    }
    setTriviaDeck((d) => (d.length ? d : buildTriviaDeck(TRIVIA_ROUND, [])));
  }, []);

  const question = triviaDeck[triviaPos] ?? TRIVIA_POOL[0];

  const initMemory = useCallback(() => {
    const cards = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    setMemoryCards(cards);
    setMemoryFlipped([]);
    setMemoryMatched([]);
    setMemoryMoves(0);
  }, []);

  // --- Paid-session wiring (Phase A3) --------------------------------------
  // Enter a game: the server debits the entry fee and returns a session id.
  // A 409 (not enough coins / daily cap) leaves the session closed and shows
  // the server's message — the game does not start unpaid.
  const enterGame = useCallback(
    async (next: GameType) => {
      setFeeNotice(null);
      // Close any session left open by the previous game before starting a new
      // one, so a half-finished round is still settled (and billed) exactly once.
      if (sessionRef.current) {
        const stale = sessionRef.current;
        sessionRef.current = null;
        finishGame(stale, 0).catch(() => undefined);
      }
      try {
        const started = await startGame(next, roomId);
        sessionRef.current = started.session_id;
        setGame(next);
        if (next === "trivia") void loadTriviaDeck();
        if (next === "memory") initMemory();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not start the game.";
        setFeeNotice(`${message} (${GAME_FEE[next]} coins)`);
      }
    },
    [roomId, loadTriviaDeck, initMemory]
  );

  // Settle the open session exactly once when a round ends. `finalScore` is the
  // client's own tally; the server clamps it and decides win/XP from the fixed
  // table, so a tampered score cannot mint XP. Wired into `settleRef` so the
  // Ludo game-over effect above can call it without a dep-cycle.
  const settleSession = useCallback((finalScore: number) => {
    const id = sessionRef.current;
    if (!id) return;
    sessionRef.current = null;
    finishGame(id, Math.max(0, Math.floor(finalScore))).catch(() => undefined);
  }, []);
  useEffect(() => { settleRef.current = settleSession; }, [settleSession]);

  /**
   * Apply one die roll to the current player. Pure logic lives in
   * `ludoMove`; here we only persist its result. The next player is decided by
   * the pure function, never by a side effect inside a setState updater.
   */
  const applyRoll = useCallback((value: number) => {
    const active = activeLudoRef.current;
    const result = ludoMove(ludoRef.current, active, value);
    setLudo(result.players);
    setLudoMsg(result.message);
    // Only the human's own rolls add to the shared score.
    if (active === 0) setScore((s) => s + value);

    const winner = result.players.find((p) => p.token >= LUDO_HOME);
    if (winner) {
      setLudoMsg(`${winner.name} wins the round! 🏁`);
      if (winner.name === "You") setScore((s) => s + 50);
    } else {
      // A 6 or a capture keeps the turn; otherwise pass it on.
      setNextLudo(result.extraTurn ? active : result.nextPlayer);
    }
  }, []);

  const rollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (rollInterval.current) clearInterval(rollInterval.current); }, []);

  const roll = useCallback(() => {
    if (rolling || gameOverRef.current) return;
    setRolling(true);
    let n = 0;
    rollInterval.current = setInterval(() => {
      setDice(1 + Math.floor(Math.random() * 6));
      n++;
      if (n > 10) {
        if (rollInterval.current) clearInterval(rollInterval.current);
        rollInterval.current = null;
        const final = 1 + Math.floor(Math.random() * 6);
        setDice(final);
        setRolling(false);
        applyRoll(final);
      }
    }, 60);
  }, [rolling, applyRoll]);

  // Local bots (Blue/Green/Gold) auto-roll a beat after their turn begins.
  useEffect(() => {
    if (game !== "ludo" || gameOver || rolling || activeLudo === 0) return;
    const timer = setTimeout(() => roll(), 900);
    return () => clearTimeout(timer);
  }, [game, gameOver, rolling, activeLudo, roll]);

  const resetLudo = () => {
    setLudo(LUDO_PLAYERS);
    setNextLudo(0);
    setDice(1);
    setScore(0);
    setLudoMsg("Roll a 6 to bring a token out of the yard.");
  };

  // Can the shown die value legally move the active token? Used to highlight
  // the token so a yard token that needs a 6 is obviously waiting on a 6.
  const humanCanMove = activeLudo === 0 && canMove(ludo, 0, dice);
  const winnerName = gameOver ? (ludo.find((p) => p.token >= LUDO_HOME)?.name ?? "") : "";

  const startReaction = () => {
    setReactionMsg("Wait for green…");
    setReactionStart(null);
    const delay = 800 + Math.random() * 2200;
    setTimeout(() => {
      setReactionStart(Date.now());
      setReactionMsg("TAP NOW!");
    }, delay);
  };

  const tapReaction = () => {
    if (reactionStart === null) {
      if (reactionMsg === "TAP NOW!") return;
      setReactionMsg("Too soon! Tap Start again.");
      return;
    }
    const ms = Date.now() - reactionStart;
    setReactionMsg(`⚡ ${ms}ms — ${ms < 200 ? "Lightning!" : ms < 350 ? "Nice!" : "Keep practicing!"}`);
    setReactionStart(null);
    const gained = Math.max(1, 10 - Math.floor(ms / 100));
    setScore((s) => s + gained);
    // Each tap is its own scored round — settle it immediately. The server
    // clamps reaction to maxScore 500 and decides win/XP from ms-free points.
    settleSession(gained);
  };

  const answerTrivia = (idx: number) => {
    if (triviaAnswer !== null) return;              // one answer per question
    setTriviaAnswer(idx);
    if (idx === question.correct) setTriviaScore((s) => s + 1);
    // Remember what was asked so the next round never repeats it while the
    // pool still has unseen questions.
    const seen = triviaSeen.includes(question.q) ? triviaSeen : [...triviaSeen, question.q];
    setTriviaSeen(seen);
    // Advance after showing the correct/wrong state.
    setTimeout(() => {
      setTriviaAnswer(null);
      if (triviaPos + 1 >= triviaDeck.length) {
        // Deck exhausted — that's the sprint's end. Settle with the correct-count
        // as the score (server clamps trivia to maxScore 10, win at 6).
        settleSession(triviaScore);
        setTriviaDeck(buildTriviaDeck(TRIVIA_ROUND, seen));
        setTriviaPos(0);
      } else {
        setTriviaPos((p) => p + 1);
      }
    }, 1500);
  };

  const flipMemoryCard = (idx: number) => {
    if (memoryFlipped.length === 2 || memoryFlipped.includes(idx) || memoryMatched.includes(memoryCards[idx])) return;
    const newFlipped = [...memoryFlipped, idx];
    setMemoryFlipped(newFlipped);
    if (newFlipped.length === 2) {
      const moves = memoryMoves + 1;
      setMemoryMoves(moves);
      if (memoryCards[newFlipped[0]] === memoryCards[newFlipped[1]]) {
        const nextMatched = [...memoryMatched, memoryCards[newFlipped[0]]];
        setMemoryMatched(nextMatched);
        setMemoryFlipped([]);
        // All 8 pairs found — settle. Fewer moves scores higher (max 10000).
        if (nextMatched.length === 8) settleSession(Math.max(0, 10000 - moves * 250));
      } else {
        setTimeout(() => setMemoryFlipped([]), 1000);
      }
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#121218]">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/5 px-3 py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => enterGame("ludo")}
          className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "ludo" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
        >
          <Dices size={13} /> Ludo
        </button>
        <button
          onClick={() => enterGame("reaction")}
          className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "reaction" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
        >
          <Zap size={13} /> Reaction
        </button>
        <button
          onClick={() => enterGame("trivia")}
          className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "trivia" ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
        >
          <Target size={13} /> Trivia
        </button>
        <button
          onClick={() => enterGame("memory")}
          className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "memory" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
        >
          <Sparkles size={13} /> Memory
        </button>
        <span className="ml-auto shrink-0 text-xs font-bold text-amber-200">{score} pts</span>
      </div>
      <div className="p-4">
        {feeNotice && (
          <p className="mb-3 rounded-lg bg-amber-500/10 px-2 py-1 text-center text-xs text-amber-300" role="alert">
            {feeNotice}
          </p>
        )}
        {game === "ludo" && (
          <div>
            <div className="mx-auto w-fit rounded-2xl bg-white/[0.04] p-2">
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${GRID}, 1.35rem)` }}
              >
                {Array.from({ length: GRID * GRID }).map((_, i) => {
                  const isTrack = TRACK.includes(i);
                  const yardIndex = YARDS.indexOf(i);
                  // The middle 3x3 is the shared home/finish area.
                  const row = Math.floor(i / GRID);
                  const col = i % GRID;
                  const isHome = row >= 2 && row <= 4 && col >= 2 && col <= 4;
                  // Which tokens sit on this cell?
                  const occupants = ludo
                    .map((p, pi) => ({ p, pi }))
                    .filter(({ p }) =>
                      p.token >= 0 && p.token < TRACK.length && TRACK[p.token] === i,
                    );
                  const yardOccupants =
                    yardIndex >= 0
                      ? ludo
                          .map((p, pi) => ({ p, pi }))
                          .filter(({ p, pi }) => p.token < 0 && pi === yardIndex)
                      : [];

                  return (
                    <div
                      key={i}
                      className={`relative flex h-[1.35rem] items-center justify-center rounded ${
                        isTrack
                          ? "bg-white/[0.16]"
                          : yardIndex >= 0
                            ? `${LUDO_PLAYERS[yardIndex].bg}/25 border ${LUDO_PLAYERS[yardIndex].bg}/50`
                            : isHome
                              ? "bg-emerald-500/20"
                              : "bg-white/[0.06]"
                      }`}
                    >
                      {(occupants.length > 0 || yardOccupants.length > 0) && (
                        <div className="flex -space-x-1">
                          {(occupants.length ? occupants : yardOccupants).map(({ p, pi }) => (
                            <span
                              key={p.name}
                              className={`h-2.5 w-2.5 rounded-full ring-1 ring-black/40 ${p.bg}${
                                pi === activeLudo && humanCanMove && !gameOver ? " ring-2 ring-white" : ""
                              }`}
                              title={p.name}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-center gap-1.5">
                {LUDO_PLAYERS.map((p, i) => (
                  <span key={p.name} className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-black ${p.bg}`}>
                    {i === activeLudo && !gameOver ? "▶ " : ""}
                    {p.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs font-bold min-[420px]:grid-cols-4 min-[420px]:text-[11px]">
              {ludo.map((p) => {
                const home = p.token >= LUDO_HOME;
                const where = home ? "HOME" : p.token < 0 ? "Yard" : `Tile ${p.token + 1}`;
                return (
                  <div key={p.name} className="rounded-xl bg-white/5 p-2">
                    <div className={`mx-auto mb-1 h-3 w-3 rounded-full ${p.bg}`} />
                    <div className="text-white/80">{p.name}</div>
                    <div className={home ? "text-emerald-400" : "text-white/55"}>{where}</div>
                  </div>
                );
              })}
            </div>

            {gameOver ? (
              <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-center">
                <Trophy size={16} className="mx-auto mb-1 text-emerald-300" />
                <p className="text-sm font-bold text-emerald-200">{winnerName} wins the round!</p>
                <p className="text-[11px] text-white/55">Final score {score} pts — reset to play again.</p>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl font-bold text-black shadow-inner">
                  {dice}
                </div>
                <button
                  onClick={roll}
                  disabled={rolling || activeLudo !== 0}
                  className="flex-1 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {rolling ? "Rolling…" : activeLudo !== 0 ? `${LUDO_PLAYERS[activeLudo].name} is rolling…` : "Roll Dice"}
                </button>
              </div>
            )}

            <p className="mt-2 text-center text-xs text-white/60" role="status" aria-live="polite">
              {gameOver ? `${winnerName} wins the round! Reset to play again.` : ludoMsg}
            </p>
            <button
              onClick={resetLudo}
              className="mt-2 w-full rounded-2xl bg-white/10 py-2 text-xs font-bold text-white transition hover:bg-white/15"
            >
              Reset game
            </button>
          </div>
        )}
        {game === "reaction" && (
          <div className="text-center">
            <div
              onClick={tapReaction}
              className={`mx-auto flex h-20 w-full cursor-pointer items-center justify-center rounded-2xl text-sm font-black transition ${reactionStart !== null ? "bg-emerald-400 text-black" : "bg-white/5 text-white/60"}`}
            >
              {reactionMsg}
            </div>
            <button
              onClick={startReaction}
              className="mt-3 w-full rounded-2xl bg-white py-2.5 text-sm font-bold text-black transition hover:bg-white/85"
            >
              Start Round
            </button>
            <p className="mt-2 text-xs text-white/40">Test your reflexes!</p>
          </div>
        )}
        {game === "trivia" && (
          <div className="text-center">
            <p className="text-sm font-bold text-white/80">{question.q}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              {question.options.map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => answerTrivia(idx)}
                  disabled={triviaAnswer !== null}
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    triviaAnswer === idx
                      ? idx === question.correct
                        ? "bg-emerald-500 text-black"
                        : "bg-red-500 text-white"
                      : triviaAnswer !== null && idx === question.correct
                        ? "bg-emerald-500/40 text-white"
                        : "bg-white/5 text-white/80 hover:bg-white/10"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/55">
              Score: {triviaScore} &middot; Question {Math.min(triviaPos + 1, triviaDeck.length)} of {triviaDeck.length}
            </p>
          </div>
        )}
        {game === "memory" && (
          <div className="text-center">
            <div className="grid grid-cols-4 gap-2">
              {memoryCards.map((card, idx) => (
                <button
                  key={idx}
                  onClick={() => flipMemoryCard(idx)}
                  className={`flex h-14 w-full items-center justify-center rounded-xl text-lg font-black transition ${
                    memoryFlipped.includes(idx) || memoryMatched.includes(card)
                      ? "bg-violet-500 text-white"
                      : "bg-white/5 text-white/30 hover:bg-white/10"
                  }`}
                >
                  {memoryFlipped.includes(idx) || memoryMatched.includes(card) ? card : "?"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/40">Moves: {memoryMoves} | Matched: {memoryMatched.length}/8</p>
            {memoryMatched.length === 8 && (
              <p className="mt-2 text-sm font-bold text-emerald-400">
                <Trophy size={14} className="mr-1 inline" /> You won in {memoryMoves} moves!
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
