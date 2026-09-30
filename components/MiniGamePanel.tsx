"use client";

import { useState, useCallback } from "react";
import { Dices, Zap, Trophy, Target, Sparkles } from "lucide-react";

type GameType = "ludo" | "reaction" | "trivia" | "memory";

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
  const [triviaAnswer, setTriviaAnswer] = useState<number | null>(null);
  const [triviaScore, setTriviaScore] = useState(0);
  const [memoryCards, setMemoryCards] = useState<number[]>([]);
  const [memoryFlipped, setMemoryFlipped] = useState<number[]>([]);
  const [memoryMatched, setMemoryMatched] = useState<number[]>([]);
  const [memoryMoves, setMemoryMoves] = useState(0);

  const TRIVIA_QUESTIONS = [
    { q: "What is the capital of France?", options: ["London", "Paris", "Berlin", "Madrid"], correct: 1 },
    { q: "Which planet is known as the Red Planet?", options: ["Venus", "Jupiter", "Mars", "Saturn"], correct: 2 },
    { q: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3 },
    { q: "How many continents are there?", options: ["5", "6", "7", "8"], correct: 2 },
  ];

  const [currentQuestion, setCurrentQuestion] = useState(0);

  const roll = () => {
    if (rolling) return;
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
      }
    }, 60);
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
    setTriviaAnswer(idx);
    if (idx === TRIVIA_QUESTIONS[currentQuestion].correct) {
      setTriviaScore((s) => s + 1);
    }
    setTimeout(() => {
      setTriviaAnswer(null);
      if (currentQuestion < TRIVIA_QUESTIONS.length - 1) {
        setCurrentQuestion((q) => q + 1);
      } else {
        setCurrentQuestion(0);
        setTriviaScore(0);
      }
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
          onClick={() => setGame("trivia")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "trivia" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
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
          <div className="text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-4xl font-black text-black shadow-inner">
              {dice}
            </div>
            <button
              onClick={roll}
              disabled={rolling}
              className="mt-3 w-full rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {rolling ? "Rolling…" : "Roll Dice"}
            </button>
            <p className="mt-2 text-xs text-white/40">Roll the dice and move your token!</p>
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
            <p className="text-sm font-bold text-white/80">{TRIVIA_QUESTIONS[currentQuestion].q}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {TRIVIA_QUESTIONS[currentQuestion].options.map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => answerTrivia(idx)}
                  disabled={triviaAnswer !== null}
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    triviaAnswer === idx
                      ? idx === TRIVIA_QUESTIONS[currentQuestion].correct
                        ? "bg-emerald-500 text-black"
                        : "bg-red-500 text-white"
                      : "bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/40">Score: {triviaScore}/{TRIVIA_QUESTIONS.length}</p>
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
