"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Games with the people met on the road (owner, 19 Oct 2026: "let them play a game, like mate in 1 chess… not just
 * options riddle"): mate in one, the three cups, and pairs. Each shows its game and sends one move to be judged by the
 * server (road_event_play); `result` is what the server said.
 */
export type RoadGame =
  | { type: "chess"; fen: string; seconds?: number }
  | { type: "cups"; start: number; swaps: [number, number][]; ms: number; seconds?: number }
  | { type: "pairs"; cards: string[]; misses: number; seconds?: number };

/** `late`: the move came after the clock ran out (owner: "some form of urgency"). */
export type RoadGameResult = { won: boolean; reward: number; answer: string | null; san: string | null; late?: boolean };

/** The seconds on the clock once the game is ready to play (the cups: once the shuffle ends). */
export const gameSeconds = (g: RoadGame) => g.seconds ?? (g.type === "chess" ? 30 : g.type === "pairs" ? 50 : 6);
/** What's sent when the time runs out: nothing that wins. */
export const timeoutMove = (g: RoadGame) => (g.type === "pairs" ? "[]" : "timeout");

/**
 * The game. `onReady`: it can be played now (the clock starts): straight away for chess and pairs, when the shuffle
 * ends for the cups. `locked`: the time is up.
 */
export function RoadGameBoard({
  game,
  result,
  locked = false,
  onReady,
  onMove,
}: {
  game: RoadGame;
  result: RoadGameResult | null;
  locked?: boolean;
  onReady?: () => void;
  onMove: (move: string) => void;
}) {
  if (game.type === "chess") return <ChessGame fen={game.fen} result={result} locked={locked} onReady={onReady} onMove={onMove} />;
  if (game.type === "cups") return <CupsGame start={game.start} swaps={game.swaps} ms={game.ms} result={result} locked={locked} onReady={onReady} onMove={onMove} />;
  return <PairsGame cards={game.cards} misses={game.misses} result={result} locked={locked} onReady={onReady} onMove={onMove} />;
}

/** Tell the scene once, when the game can be played. */
function useReady(onReady: (() => void) | undefined, ready = true) {
  const told = useRef(false);
  useEffect(() => {
    if (ready && !told.current) {
      told.current = true;
      onReady?.();
    }
  }, [ready, onReady]);
}

/** What each game is, in a few words (the person who offers it says it). */
export function gameIntro(game: RoadGame) {
  return game.type === "chess"
    ? "Mate in one: White to move. Find the checkmate"
    : game.type === "cups"
      ? "Watch the coin under the cups: follow it through the shuffle and find it"
      : `Turn two cards at a time and find all six pairs, not more than ${game.misses} misses`;
}

// ---- Mate in one -------------------------------------------------------------------------------------------------

const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";

function boardOf(fen: string): (string | null)[][] {
  // rows[0] is rank 8
  return fen
    .split(" ")[0]
    .split("/")
    .map((row) => {
      const out: (string | null)[] = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null);
        else out.push(ch);
      }
      return out;
    });
}

function ChessGame({
  fen,
  result,
  locked,
  onReady,
  onMove,
}: {
  fen: string;
  result: RoadGameResult | null;
  locked: boolean;
  onReady?: () => void;
  onMove: (move: string) => void;
}) {
  useReady(onReady);
  const [board, setBoard] = useState(() => boardOf(fen));
  const [from, setFrom] = useState<string | null>(null);
  const [played, setPlayed] = useState<string | null>(null);
  const at = (s: string) => board[8 - Number(s[1])][FILES.indexOf(s[0])];
  const isWhite = (p: string | null) => !!p && p === p.toUpperCase();

  function tap(s: string) {
    if (played || locked) return;
    if (isWhite(at(s))) {
      setFrom(s === from ? null : s);
      return;
    }
    if (!from) return;
    // Show the move on the board, then send it.
    const next = board.map((row) => [...row]);
    next[8 - Number(s[1])][FILES.indexOf(s[0])] = at(from);
    next[8 - Number(from[1])][FILES.indexOf(from[0])] = null;
    setBoard(next);
    setPlayed(`${from}${s}`);
    setFrom(null);
    onMove(`${from}${s}`);
  }

  const solution = result?.answer ?? null;
  const mark = (s: string) => {
    if (s === from) return "ring-2 ring-inset ring-gold";
    if (result && solution && (s === solution.slice(0, 2) || s === solution.slice(2, 4))) return "ring-2 ring-inset ring-[#3DD68C]";
    if (result && !result.won && played && (s === played.slice(0, 2) || s === played.slice(2, 4))) return "ring-2 ring-inset ring-danger";
    return "";
  };
  return (
    <div className="flex flex-col items-center gap-1.5" aria-label="Mate in one">
      <div className="grid aspect-square w-full max-w-[19rem] grid-cols-8 overflow-hidden rounded-lg shadow-lg ring-2 ring-[#5B3A1E]">
        {board.flatMap((row, r) =>
          row.map((p, f) => {
            const s = `${FILES[f]}${8 - r}`;
            return (
              <button
                key={s}
                type="button"
                data-square={s}
                onClick={() => tap(s)}
                className={`relative flex aspect-square items-center justify-center ${(r + f) % 2 ? "bg-[#B07D4F]" : "bg-[#EBD9B4]"} ${mark(s)}`}
                aria-label={`${s}${p ? ` ${isWhite(p) ? "white" : "black"} ${p.toLowerCase()}` : ""}`}
              >
                {p && (
                  <span
                    className="select-none text-[1.55rem] leading-none"
                    style={
                      isWhite(p)
                        ? { color: "#FFFFFF", textShadow: "0 0 1px #000, 0 0 1px #000, 0 1px 1px #000" }
                        : { color: "#141414", textShadow: "0 0 1px #fff4" }
                    }
                  >
                    {GLYPH[p.toLowerCase()]}
                  </span>
                )}
                {r === 7 && <span className="absolute bottom-0 right-0.5 text-[8px] font-bold text-ink/60">{FILES[f]}</span>}
                {f === 0 && <span className="absolute left-0.5 top-0 text-[8px] font-bold text-ink/60">{8 - r}</span>}
              </button>
            );
          }),
        )}
      </div>
      <p className="text-[11px] text-muted">
        {result ? (result.won ? `✓ ${result.san}` : `The mate was ${result.san}`) : locked ? "Time!" : played ? "…" : from ? `${from}: now tap where it goes` : "Tap a white piece, then where it goes"}
      </p>
    </div>
  );
}

// ---- The three cups --------------------------------------------------------------------------------------------

function CupsGame({
  start,
  swaps,
  ms,
  result,
  locked,
  onReady,
  onMove,
}: {
  start: number;
  swaps: [number, number][];
  ms: number;
  result: RoadGameResult | null;
  locked: boolean;
  onReady?: () => void;
  onMove: (move: string) => void;
}) {
  // slotOf[cup] = where that cup stands (0 left, 1 middle, 2 right); the coin is under cup `start`.
  const [slotOf, setSlotOf] = useState([0, 1, 2]);
  const [phase, setPhase] = useState<"show" | "shuffle" | "pick" | "picked">("show");
  const [picked, setPicked] = useState<number | null>(null);
  const timer = useRef(0);
  useReady(onReady, phase === "pick");
  useEffect(() => {
    let i = -1;
    const step = () => {
      i++;
      if (i === 0) {
        timer.current = window.setTimeout(step, 1500); // the coin is shown, then the cup comes down
        return;
      }
      if (i === 1) setPhase("shuffle");
      const k = i - 1;
      if (k >= swaps.length) {
        setPhase("pick");
        return;
      }
      const [a, b] = swaps[k];
      setSlotOf((s) => s.map((slot) => (slot === a ? b : slot === b ? a : slot)));
      timer.current = window.setTimeout(step, ms);
    };
    step();
    return () => window.clearTimeout(timer.current);
  }, [swaps, ms]);

  const lifted = phase === "show" || !!result;
  const coinSlot = result?.answer != null ? Number(result.answer) : slotOf[start];
  return (
    <div className="flex flex-col items-center gap-1.5" aria-label="The three cups">
      <div className="relative h-28 w-full max-w-[19rem] rounded-xl bg-[#6B4A2B] shadow-inner ring-2 ring-[#4A3422]">
        {/* The coin, under its cup */}
        <span
          className="absolute bottom-3 h-5 w-5 -translate-x-1/2 rounded-full bg-gold shadow ring-2 ring-[#B8860B] transition-[left] ease-in-out"
          style={{ left: `${(100 * (coinSlot + 0.5)) / 3}%`, transitionDuration: `${ms * 0.85}ms`, opacity: lifted ? 1 : 0 }}
          aria-hidden="true"
        />
        {[0, 1, 2].map((cup) => {
          const slot = slotOf[cup];
          return (
            <button
              key={cup}
              type="button"
              data-cup-slot={slot}
              disabled={phase !== "pick" || locked}
              onClick={() => {
                setPicked(slot);
                setPhase("picked");
                onMove(String(slot));
              }}
              className="absolute bottom-2 h-16 w-14 -translate-x-1/2 transition-all ease-in-out"
              style={{
                left: `${(100 * (slot + 0.5)) / 3}%`,
                transitionDuration: `${ms * 0.85}ms`,
                transform: `translateX(-50%) translateY(${lifted ? -34 : 0}px)`,
              }}
              aria-label={`Cup ${["on the left", "in the middle", "on the right"][slot]}`}
            >
              <svg viewBox="0 0 56 64" className={`h-full w-full drop-shadow ${picked === slot ? "brightness-125" : ""}`} aria-hidden="true">
                <path d="M10 6h36l-6 54H16z" fill="#D62828" stroke="#8E1B1B" strokeWidth="2.5" strokeLinejoin="round" />
                <path d="M12 16h32" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="3" />
              </svg>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">
        {phase === "show"
          ? "Watch the coin…"
          : phase === "shuffle"
            ? "Follow it!"
            : result
              ? result.won
                ? "✓ Found it"
                : result.late
                  ? "Time!"
                  : "Not that one"
              : locked
                ? "Time!"
                : phase === "pick"
                  ? "Which cup? Tap it, quick!"
                  : "…"}
      </p>
    </div>
  );
}

// ---- Pairs -------------------------------------------------------------------------------------------------------

function PairsGame({
  cards,
  misses,
  result,
  locked,
  onReady,
  onMove,
}: {
  cards: string[];
  misses: number;
  result: RoadGameResult | null;
  locked: boolean;
  onReady?: () => void;
  onMove: (move: string) => void;
}) {
  useReady(onReady);
  const [flips, setFlips] = useState<number[]>([]);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState(0);
  const [over, setOver] = useState(false);

  function flip(i: number) {
    if (over || locked || open.length >= 2 || open.includes(i) || matched.has(i)) return;
    const nowOpen = [...open, i];
    const log = [...flips, i];
    setOpen(nowOpen);
    setFlips(log);
    if (nowOpen.length < 2) return;
    const [a, b] = nowOpen;
    if (cards[a] === cards[b]) {
      const m = new Set(matched).add(a).add(b);
      setMatched(m);
      setOpen([]);
      if (m.size === cards.length) {
        setOver(true);
        onMove(JSON.stringify(log));
      }
    } else {
      const w = wrong + 1;
      setWrong(w);
      if (w > misses) {
        setOver(true);
        onMove(JSON.stringify(log));
      }
      window.setTimeout(() => setOpen([]), 750);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5" aria-label="Pairs">
      <div className="grid w-full max-w-[19rem] grid-cols-4 gap-1.5">
        {cards.map((c, i) => {
          const up = open.includes(i) || matched.has(i) || (!!result && !result.won);
          return (
            <button
              key={i}
              type="button"
              data-card={i}
              onClick={() => flip(i)}
              className={`flex aspect-[3/4] items-center justify-center rounded-lg text-2xl shadow transition-colors ${
                matched.has(i) ? "bg-[#1E9E62]/30 ring-2 ring-[#3DD68C]" : up ? "bg-paper" : "bg-[#2F6FEB] ring-1 ring-[#5FA8E6]"
              }`}
              aria-label={up ? c : "A card, face down"}
            >
              {up ? c : <span className="text-base text-paper/70">✦</span>}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">
        {matched.size / 2} of {cards.length / 2} pairs · misses {wrong} of {misses}
        {result ? (result.won ? " · ✓ All found" : " · too many misses") : ""}
      </p>
    </div>
  );
}
