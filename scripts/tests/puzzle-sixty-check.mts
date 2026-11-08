// Every puzzle fair in 60 seconds (owner, 3 Nov 2026: "the suduko game should be 80% completed, and each puzzle time
// should be 60. You need to verify all the puzzle ditched out can be completed with 60secs"). For each kind and level,
// many seeds through the game's own makePuzzle (the sizes the game uses): each makes a puzzle (a unique answer: the
// generators insist), the answer is right by the game's own check, and:
//   - how much there is to do: the taps or squares the answer takes, and the time the hand needs for them (a tap
//     0.6 s, a square dragged through 0.3 s, a letter 0.35 s, a Sudoku square 1.2 s: chosen, then its number), at most
//     30 s, so at least half the minute is left for thinking;
//   - Sudoku: one empty square in each 3×3 box (72 of 81 given: owner, 7 Nov 2026; was 65), and solvable by plain deduction (each empty square has one possible number, square
//     after square): no guessing.
// Thinking time can't be measured by a machine: the hand time is the floor, and the sizes keep the thinking small.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/puzzle-sixty-check.mts [seeds]
// Each kind and level now has its own time (owner, 8 Nov 2026: "add the right time to solving this if 60 secs is not
// right"): the hand may take at most half of it. With DB=1, the database's puzzle_seconds() must give the same times.
import { checkPuzzle, makePuzzle, puzzleSeconds, PUZZLE_SECONDS, type PuzzleKind } from "../../src/game/puzzles/index.ts";

const SEEDS = Number(process.argv[2] ?? 40);
// Every kind the game picks now (owner, 4 Nov 2026: no more Sentries; the quick ones in)
const KINDS: Exclude<PuzzleKind, "tornmap">[] = ["route", "adire", "sudoku", "threads", "plots", "patchwork", "vowels", "grammar", "algebra", "countries", "flags", "brands"];
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

/** How many inputs the answer takes on the board (taps, squares drawn, letters). */
function inputs(kind: string, puzzle: unknown, answer: unknown): number {
  const p = puzzle as Record<string, unknown>;
  if (kind === "sentries") return (answer as number[]).length;
  if (kind === "route") return (answer as number[]).length; // squares swept through, in one drag or several
  if (kind === "adire") return (p.n as number) ** 2 - Object.keys((p.given as object) ?? {}).length;
  if (kind === "sudoku") return (p.given as number[]).filter((v) => !v).length;
  if (kind === "threads") return (answer as number[][]).reduce((n, t) => n + t.length, 0);
  if (kind === "plots") return Object.keys((p.clues as object) ?? {}).length * 2;
  if (kind === "patchwork") return ((p.pieces as unknown[]) ?? []).length * 2;
  if (kind === "vowels") return (answer as string[]).reduce((n, w) => n + w.length, 0);
  if (kind === "grammar" || kind === "flags" || kind === "brands") return (answer as number[]).length + 1; // a tap each, and Check
  if (kind === "algebra") return (answer as number[]).reduce((n, x) => n + String(x).length, 0) + 1;
  if (kind === "countries") return (answer as string[]).reduce((n, w) => n + w.length, 0) + 1;
  return 0;
}

/** Seconds the hand needs for that many inputs (no thinking): see the top. */
const HAND: Record<string, number> = { sentries: 0.6, route: 0.3, adire: 0.6, sudoku: 1.2, threads: 0.3, plots: 0.6, patchwork: 0.6, vowels: 0.35, grammar: 0.6, flags: 0.6, brands: 0.6, algebra: 0.6, countries: 0.35 };
const handMax = (kind: PuzzleKind, level: number) => puzzleSeconds(kind, level) / 2;

/** Sudoku by plain deduction: fill any square with only one possible number, again and again; stuck = guessing. */
function singlesSolve(given: number[]) {
  const g = given.slice();
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const r = Math.floor(i / 9), c = i % 9, b = Math.floor(r / 3) * 3 * 9 + Math.floor(c / 3) * 3;
      const used = new Set<number>();
      for (let k = 0; k < 9; k++) {
        used.add(g[r * 9 + k]);
        used.add(g[k * 9 + c]);
        used.add(g[b + Math.floor(k / 3) * 9 + (k % 3)]);
      }
      const can = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((v) => !used.has(v));
      if (can.length === 1) {
        g[i] = can[0];
        changed = true;
      }
    }
  }
  return g.every(Boolean);
}

for (const kind of KINDS) {
  for (const level of [1, 2, 3]) {
    let made = 0, right = 0, plain = 0, most = 0, slowest = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const t0 = performance.now();
      let out: { puzzle: unknown; answer: unknown };
      try {
        out = makePuzzle(kind, level, seed * 7919);
      } catch {
        continue;
      }
      slowest = Math.max(slowest, performance.now() - t0);
      made++;
      // The game's own check, with the answer as the board hands it in (Sentries: [row, col] pairs).
      const handed = kind === "sentries" ? (out.answer as number[]).map((c, r) => [r, c]) : out.answer;
      if (checkPuzzle(kind, out.puzzle as never, handed, out.answer)) right++;
      most = Math.max(most, inputs(kind, out.puzzle, out.answer));
      if (kind === "sudoku" && singlesSolve((out.puzzle as { given: number[] }).given)) plain++;
    }
    const hand = most * HAND[kind];
    const extra0 = `, hand ${hand.toFixed(1)} s of ${puzzleSeconds(kind, level)} s`;
    const extra = extra0 + (kind === "sudoku" ? `, ${plain}/${made} by plain deduction, ${81 - most} of 81 given (${Math.round(((81 - most) / 81) * 100)}%)` : "");
    check(
      `${kind} level ${level}: ${made}/${SEEDS} made, ${right} right by the game's check; at most ${most} inputs${extra}; slowest to make ${Math.round(slowest)} ms`,
      made === SEEDS && right === made && hand <= handMax(kind, level) && (kind !== "sudoku" || (plain === made && 81 - most === 72)),
    );
  }
}
// The Torn Map (it needs a real place's streets, so it isn't made here): 3 × 3 at every level, 9 pieces to drop in
// (1.5 s each), and from level 3 turned too (up to 3 taps a piece, 0.4 s each).
for (const level of [1, 2, 3]) {
  const hand = 9 * 1.5 + (level >= 3 ? 9 * 3 * 0.4 : 0);
  check(`tornmap level ${level}: 9 pieces; hand ${hand.toFixed(1)} s at most of ${puzzleSeconds("tornmap", level)} s`, hand <= handMax("tornmap", level));
}
if (process.env.DB) {
  const { createRequire } = await import("node:module");
  const app = createRequire(new URL("../../package.json", import.meta.url));
  const { createClient } = app("@supabase/supabase-js");
  process.loadEnvFile(new URL("../../.env.local", import.meta.url));
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const differ: string[] = [];
  for (const kind of Object.keys(PUZZLE_SECONDS) as PuzzleKind[]) {
    for (const level of [1, 2, 3]) {
      const { data } = await admin.rpc("puzzle_seconds", { p_kind: kind, p_level: level });
      if (data !== puzzleSeconds(kind, level)) differ.push(`${kind} ${level}: ${data} vs ${puzzleSeconds(kind, level)}`);
    }
  }
  check("the database's puzzle_seconds() gives every kind and level the same time as the game", differ.length === 0, differ.join("; "));
}
console.log(fails ? `${fails} FAILED` : "all passed");
