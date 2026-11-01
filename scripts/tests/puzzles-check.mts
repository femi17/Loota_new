// The Key Trial puzzles (owner, 24 Oct 2026: "different kinds of mini puzzle game… LinkedIn… Netflix"): for each kind
// and size, many seeds: the puzzle has exactly one answer, the stored answer passes the check, a wrong one fails, and
// making one is quick enough to do when a chest opens.
//   node scripts/tests/puzzles-check.mts [count]
import { makeSentries, solveSentries, checkSentries } from "../../src/game/puzzles/sentries.ts";
import { makeRoute, solveRoute, checkRoute } from "../../src/game/puzzles/route.ts";
import { makeAdire, solveAdire, checkAdire } from "../../src/game/puzzles/adire.ts";
import { makeSudoku, solveSudoku, checkSudoku } from "../../src/game/puzzles/sudoku.ts";
import { makeThreads, checkThreads } from "../../src/game/puzzles/threads.ts";
import { makePlots, solvePlots, checkPlots } from "../../src/game/puzzles/plots.ts";
import { makePatchwork, checkPatchwork } from "../../src/game/puzzles/patchwork.ts";
import { makeVowels, checkVowels } from "../../src/game/puzzles/vowels.ts";

const COUNT = Number(process.argv[2] ?? 20);
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

function run<P, A>(name: string, make: (seed: number) => { puzzle: P; answer: A }, unique: (p: P) => boolean, right: (p: P, a: A) => boolean, wrong: (p: P, a: A) => boolean, describe: (p: P) => string) {
  const times: number[] = [];
  let allUnique = true, allRight = true, allWrongCaught = true;
  let sample = "";
  for (let s = 1; s <= COUNT; s++) {
    const t0 = performance.now();
    const { puzzle, answer } = make(s * 7919);
    times.push(performance.now() - t0);
    if (!unique(puzzle)) allUnique = false;
    if (!right(puzzle, answer)) allRight = false;
    if (wrong(puzzle, answer)) allWrongCaught = false;
    if (s === 1) sample = describe(puzzle);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)], max = times.at(-1)!;
  check(`${name}: ${COUNT} puzzles, each with exactly one answer`, allUnique);
  check(`${name}: the answer passes the check`, allRight);
  check(`${name}: a wrong answer fails it`, allWrongCaught);
  check(`${name}: made quickly (median ${p50.toFixed(0)} ms, slowest ${max.toFixed(0)} ms)`, max < 3000, sample);
}

for (const n of [7, 8, 9]) {
  run(`Sentries ${n}×${n}`, (seed) => makeSentries(seed, n), (p) => solveSentries(p, 2).length === 1,
    (p, a) => checkSentries(p, a.map((c, r) => [r, c])),
    (p, a) => checkSentries(p, a.map((c, r) => [r, r === 0 ? (c + 2) % p.n : c])),
    (p) => `${p.n} districts`);
}
for (const [n, keep] of [[5, 6], [6, 7], [7, 8]] as const) {
  run(`Route ${n}×${n}`, (seed) => makeRoute(seed, n, keep), (p) => (solveRoute(p, 2, 2_000_000) ?? []).length === 1,
    (p, a) => checkRoute(p, a),
    (p, a) => checkRoute(p, [...a.slice(0, -2), a.at(-1)!, a.at(-2)!]),
    (p) => `${Object.keys(p.numbers).length} numbers, ${p.walls.length} walls`);
}
for (const [n, clues] of [[6, 10], [6, 8], [6, 6]] as const) {
  run(`Adire ${n}×${n} (~${clues} clues)`, (seed) => makeAdire(seed, n, clues), (p) => solveAdire(p, 2).length === 1,
    (p, a) => checkAdire(p, a),
    (p, a) => checkAdire(p, a.map((v, i) => (i === 0 ? 1 - v : v))),
    (p) => `${Object.keys(p.given).length} squares given, ${p.signs.length} signs`);
}
// The puzzles added on 1 Nov 2026 (owner: "lets include these puzzles, for the sudoku, we can half solved it"). Threads
// and Patchwork take any answer that keeps the rules (no uniqueness needed); Sudoku and Plots have exactly one.
for (const givens of [44, 40, 36]) {
  run(`Sudoku (${givens} given)`, (seed) => makeSudoku(seed, givens), (p) => solveSudoku(p.given, 2).length === 1 && p.given.filter(Boolean).length === givens,
    (p, a) => checkSudoku(p, a),
    (p, a) => checkSudoku(p, a.map((v, i) => (i === a.findIndex((_, j) => !p.given[j]) ? (v % 9) + 1 : v))),
    (p) => `${p.given.filter(Boolean).length} of 81 given`);
}
for (const [n, colours] of [[5, 4], [6, 5], [7, 6]] as const) {
  run(`Threads ${n}×${n}`, (seed) => makeThreads(seed, n, colours), () => true,
    (p, a) => checkThreads(p, a),
    (p, a) => checkThreads(p, [a[0].slice(0, -1), ...a.slice(1)]),
    (p) => `${p.ends.length} colours`);
}
for (const [n, most] of [[5, 6], [6, 8], [7, 9]] as const) {
  run(`Plots ${n}×${n}`, (seed) => makePlots(seed, n, most), (p) => solvePlots(p, 2).length === 1,
    (p, a) => checkPlots(p, a),
    (p, a) => checkPlots(p, a.slice(1)),
    (p) => `${Object.keys(p.clues).length} plots`);
}
for (const n of [4, 5, 6]) {
  run(`Patchwork ${n}×${n}`, (seed) => makePatchwork(seed, n), () => true,
    (p, a) => checkPatchwork(p, a),
    (p, a) => checkPatchwork(p, a.map((x, i) => (i === 0 ? { ...x, c: x.c + 1 } : x))),
    (p) => `${p.target.length} squares, ${p.pieces.length} patches`);
}
for (const count of [3, 4, 5]) {
  run(`Lost Vowels (${count} words)`, (seed) => makeVowels(seed, count), (p) => p.words.length === count && p.words.every((w) => !/[AEIOU]/.test(w.shown)),
    (p, a) => checkVowels(a, a.map((w) => w.toLowerCase())),
    (p, a) => checkVowels(a, a.map((w, i) => (i === 0 ? w.slice(1) : w))),
    (p) => `${p.theme}: ${p.words.map((w) => w.shown).join(", ")}`);
}
console.log(fails ? `${fails} FAILED` : "all passed");
