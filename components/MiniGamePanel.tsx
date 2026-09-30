"use client";

import { useState, useCallback } from "react";
import { Dices, Zap, Trophy, Target, Sparkles } from "lucide-react";

type GameType = "ludo" | "reaction" | "trivia" | "memory";

/**
 * Board geometry: a 7x7 grid whose perimeter is the shared track, with the four
 * corners as private yards and the middle 3x3 as home/finish.
 *
 * The track is a clockwise ring of 20 tiles, listed in walking order so a token
 * position is just an index into this array. Four colours share it, spaced five
 * tiles apart so they cannot start on top of each other.
 */
const GRID = 7;
const TRACK: number[] = [
  // top edge, left→right (corners are yards, skipped)
  1, 2, 3, 4, 5,
  // right edge, top→bottom
  13, 20, 27, 34, 41,
  // bottom edge, right→left
  47, 46, 45, 44, 43,
  // left edge, bottom→top
  35, 28, 21, 14, 7,
];
const YARDS = [0, 6, 42, 48];               // top-left, top-right, bottom-right, bottom-left
const START = [0, 5, 10, 15];               // each colour's entry tile on TRACK
const LUDO_HOME = TRACK.length;             // token has walked the whole track

interface LudoPlayer {
  name: string;
  /** Token colour class, also used for its yard. */
  bg: string;
  /** -1 = in the yard, 0..19 = index into TRACK, LUDO_HOME = home. */
  token: number;
}
const LUDO_PLAYERS: LudoPlayer[] = [
  { name: "You", bg: "bg-rose-400", token: -1 },
  { name: "Blue", bg: "bg-sky-400", token: -1 },
  { name: "Green", bg: "bg-emerald-400", token: -1 },
  { name: "Gold", bg: "bg-amber-400", token: -1 },
];

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
  // A deck is shuffled and dealt from, so questions are never repeated until
  // the whole pool is exhausted. Cycling an index over a fixed list re-asked the
  // same four questions forever.
  const [triviaAnswer, setTriviaAnswer] = useState<number | null>(null);
  const [triviaDeck, setTriviaDeck] = useState<number[]>([]);
  const [triviaPos, setTriviaPos] = useState(0);
  const [triviaScore, setTriviaScore] = useState(0);
  const [triviaSeen, setTriviaSeen] = useState(0);
  const [memoryCards, setMemoryCards] = useState<number[]>([]);
  const [memoryFlipped, setMemoryFlipped] = useState<number[]>([]);
  const [memoryMatched, setMemoryMatched] = useState<number[]>([]);
  const [memoryMoves, setMemoryMoves] = useState(0);

  const TRIVIA_QUESTIONS = [
    { q: "What is the capital of France?", options: ["London", "Paris", "Berlin", "Madrid"], correct: 1 },
    { q: "Which planet is known as the Red Planet?", options: ["Venus", "Jupiter", "Mars", "Saturn"], correct: 2 },
    { q: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3 },
    { q: "How many continents are there?", options: ["5", "6", "7", "8"], correct: 2 },
    { q: "What is the smallest prime number?", options: ["0", "1", "2", "3"], correct: 2 },
    { q: "Which gas do plants absorb from the air?", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], correct: 2 },
    { q: "Who painted the Mona Lisa?", options: ["Van Gogh", "Da Vinci", "Picasso", "Monet"], correct: 1 },
    { q: "What is the hardest natural substance on Earth?", options: ["Quartz", "Diamond", "Titanium", "Granite"], correct: 1 },
    { q: "How many bones are in the adult human body?", options: ["186", "206", "226", "246"], correct: 1 },
    { q: "What is the longest river in the world?", options: ["Amazon", "Nile", "Yangtze", "Mississippi"], correct: 1 },
    { q: "Which element has the chemical symbol Au?", options: ["Silver", "Gold", "Aluminium", "Argon"], correct: 1 },
    { q: "What is the largest mammal on Earth?", options: ["African elephant", "Blue whale", "Giraffe", "Sperm whale"], correct: 1 },
    { q: "In which country would you find Machu Picchu?", options: ["Chile", "Bolivia", "Peru", "Colombia"], correct: 2 },
    { q: "What does 'HTTP' stand for?", options: ["HyperText Transfer Protocol", "High Transfer Text Process", "Hyperlink Text Transport Path", "Home Tool Transfer Program"], correct: 0 },
    { q: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], correct: 1 },
    { q: "Which is the smallest prime number greater than 10?", options: ["11", "12", "13", "14"], correct: 0 },
  ];

  // Deal a shuffled copy of the question indices, reshuffling when exhausted.
  const nextTriviaDeck = useCallback((seen: number): number[] => {
    const idx = TRIVIA_QUESTIONS.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return seen >= idx.length ? idx : idx.slice(0, idx.length - seen);
  }, []);

  const ensureTriviaDeck = useCallback(() => {
    setTriviaDeck((d) => (d.length ? d : nextTriviaDeck(0)));
    setTriviaPos(0);
    setTriviaSeen(0);
    setTriviaScore(0);
    setTriviaAnswer(null);
  }, [nextTriviaDeck]);

  const question = triviaDeck[triviaPos]
    ? TRIVIA_QUESTIONS[triviaDeck[triviaPos]]
    : TRIVIA_QUESTIONS[0];

  const roll = () => {
    if (rolling || gameOver) return;
    setRolling(true);
    let n = 0;
    const t = setInterval(() => {
      setDice(1 + Math.floor(Math.random() * 6));
      n++;
      if (n > 10) {
        clearInterval(t);
        const final = 1 + Math.floor(Math.random() * 6);
        setDice(final);
        setRolling(false);
        setScore((s) => s + final);
        moveTokens(final);
      }
    }, 60);
  };

  // --- Ludo rules ---------------------------------------------------------
  // A token starts in the yard at -1. A 6 releases one. Moving from the yard
  // (or from the last tile) onto a 6 sends that token back to the yard, which
  // is the standard Ludo rule that makes a 6 worth chasing rather than free.
  const moveTokens = (value: number) => {
    setLudo((prev) => {
      const next = prev.map((p) => ({ ...p }));
      const mover = next[activeLudo];

      if (mover.token < 0) {
        // Leaving the yard needs an exact 6.
        if (value !== 6) return prev;
        mover.token = START[activeLudo];
        // Roll again for the extra turn a 6 grants.
        setNextLudo(activeLudo);
        return next;
      }

      const nextTile = mover.token + value;
      if (value === 6 || nextTile >= LUDO_HOME) {
        if (nextTile >= LUDO_HOME) mover.token = LUDO_HOME;
        else mover.token = -1;
        setNextLudo(activeLudo);
        return next;
      }

      mover.token = nextTile;
      setNextLudo((activeLudo + 1) % next.length);
      return next;
    });
  };

  const [activeLudo, setNextLudo] = useState(0);
  const [ludo, setLudo] = useState(LUDO_PLAYERS);
    const gameOver = ludo.some((p) => p.token >= LUDO_HOME);
  const resetLudo = () => {
    setLudo(LUDO_PLAYERS);
    setNextLudo(0);
    setDice(1);
    setScore(0);
  };

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
    setScore((s) => s + Math.max(1, 10 - Math.floor(ms / 100)));
  };

  const answerTrivia = (idx: number) => {
    if (triviaAnswer !== null) return;              // one answer per question
    setTriviaAnswer(idx);
    const correct = question.correct;
    if (idx === correct) setTriviaScore((s) => s + 1);
    const seen = triviaSeen + 1;
    setTriviaSeen(seen);
    // Advance after showing the correct/wrong state. If the pool runs out,
    // reshuffle a fresh deck instead of replaying the same questions in order.
    setTimeout(() => {
      setTriviaAnswer(null);
      setTriviaDeck((d) => {
        if (triviaPos + 1 >= d.length) return nextTriviaDeck(seen);
        return d;
      });
      setTriviaPos((p) => (triviaSeen >= TRIVIA_QUESTIONS.length ? 0 : p + 1));
    }, 1500);
  };

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

  const flipMemoryCard = (idx: number) => {
    if (memoryFlipped.length === 2 || memoryFlipped.includes(idx) || memoryMatched.includes(memoryCards[idx])) return;
    const newFlipped = [...memoryFlipped, idx];
    setMemoryFlipped(newFlipped);
    if (newFlipped.length === 2) {
      setMemoryMoves((m) => m + 1);
      if (memoryCards[newFlipped[0]] === memoryCards[newFlipped[1]]) {
        setMemoryMatched((m) => [...m, memoryCards[newFlipped[0]]]);
        setMemoryFlipped([]);
      } else {
        setTimeout(() => setMemoryFlipped([]), 1000);
      }
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#121218]">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
        <button
          onClick={() => setGame("ludo")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "ludo" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
        >
          <Dices size={13} /> Ludo
        </button>
        <button
          onClick={() => setGame("reaction")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "reaction" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
        >
          <Zap size={13} /> Reaction
        </button>
        <button
onClick={() => {
            setGame("trivia");
            ensureTriviaDeck();
          }}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "trivia" ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
        >
          <Target size={13} /> Trivia
        </button>
        <button
          onClick={() => { setGame("memory"); initMemory(); }}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "memory" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
        >
          <Sparkles size={13} /> Memory
        </button>
        <span className="ml-auto text-xs font-bold text-amber-200">{score} pts</span>
      </div>
      <div className="p-4">
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
                          {(occupants.length ? occupants : yardOccupants).map(({ p }) => (
                            <span
                              key={p.name}
                              className={`h-2.5 w-2.5 rounded-full ring-1 ring-black/40 ${p.bg}`}
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
                    {i === activeLudo ? "▶ " : ""}
                    {p.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-bold">
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

            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl font-bold text-black shadow-inner">
                {dice}
              </div>
              <button
                onClick={roll}
                disabled={rolling || gameOver}
                className="flex-1 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {rolling ? "Rolling…" : gameOver ? "Game over" : "Roll Dice"}
              </button>
            </div>

            <p className="mt-2 text-center text-xs text-white/60">
              {gameOver
                ? `${ludo.find((p) => p.token >= LUDO_HOME)?.name ?? "Nobody"} wins! Reset to play again.`
                : `${LUDO_PLAYERS[activeLudo].name}'s turn. Roll a 6 to bring a token out of the yard.`}
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
            <div className="mt-3 grid grid-cols-2 gap-2">
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
                      : "bg-white/5 text-white/80 hover:bg-white/10"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/55">
              Score: {triviaScore} &middot; Question {Math.min(triviaSeen + 1, TRIVIA_QUESTIONS.length)} of {TRIVIA_QUESTIONS.length}
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
