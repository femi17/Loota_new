/**
 * Threads (a Key Trial puzzle, owner, 1 Nov 2026, after the "connect the pairs" puzzles): pairs of coloured beads on a
 * grid. Join each pair with one thread; threads never cross or share a square, and together they fill every square.
 * Made by laying one long random thread through every square and cutting it into pieces: the ends become the beads.
 * Any answer that keeps the rules is right.
 */
import { seeded, type Rng } from "./rng.ts";

/** What the player sees: the grid's size and each colour's two beads (squares, row by row). */
export type ThreadsPuzzle = { n: number; ends: [number, number][] };
/** The answer: each colour's thread, square by square from one bead to the other. */
export type ThreadsAnswer = number[][];

/** A path through every square of an n×n grid: a snake, then many random "backbite" moves to tangle it. */
function longThread(n: number, rng: Rng): number[] {
  let path: number[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) path.push(r * n + (r % 2 ? n - 1 - c : c));
  const near = (i: number) => {
    const r = Math.floor(i / n), c = i % n;
    return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n).map(([a, b]) => a * n + b);
  };
  for (let k = 0; k < n * n * 30; k++) {
    if (rng.next() < 0.5) path.reverse();
    const end = path[path.length - 1];
    const options = near(end).filter((v) => v !== path[path.length - 2]);
    const v = options[rng.int(options.length)];
    const at = path.indexOf(v);
    // The end joins its neighbour v; the part after v turns round.
    path = [...path.slice(0, at + 1), ...path.slice(at + 1).reverse()];
  }
  return path;
}

/** A puzzle `n` squares a side with `colours` threads (each at least 3 squares long). */
export function makeThreads(seed: number, n: number, colours: number): { puzzle: ThreadsPuzzle; answer: ThreadsAnswer } {
  const rng = seeded(seed);
  for (let tries = 0; tries < 200; tries++) {
    const path = longThread(n, rng);
    // Cut points: `colours` pieces, each 3 squares or more, lengths a little uneven.
    const total = n * n;
    const lengths = new Array(colours).fill(3);
    for (let left = total - 3 * colours; left > 0; left--) lengths[rng.int(colours)]++;
    const pieces: number[][] = [];
    let at = 0;
    for (const len of lengths) {
      pieces.push(path.slice(at, at + len));
      at += len;
    }
    // Beads side by side make a thread too easy to see: try again.
    const touching = pieces.some((p) => {
      const [a, b] = [p[0], p[p.length - 1]];
      return Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n)) === 1;
    });
    if (touching && tries < 150) continue;
    const order = rng.shuffle([...pieces.keys()]);
    const answer = order.map((k) => pieces[k]);
    return { puzzle: { n, ends: answer.map((p) => [p[0], p[p.length - 1]] as [number, number]) }, answer };
  }
  throw new Error(`No Threads puzzle for seed ${seed}`);
}

/** Is this a right answer? Each thread joins its beads square by square; none share a square; every square is used. */
export function checkThreads(p: ThreadsPuzzle, a: number[][]): boolean {
  const { n, ends } = p;
  if (!Array.isArray(a) || a.length !== ends.length) return false;
  const used = new Set<number>();
  for (let k = 0; k < ends.length; k++) {
    const t = a[k];
    if (!Array.isArray(t) || t.length < 2) return false;
    const [x, y] = ends[k];
    if (!((t[0] === x && t[t.length - 1] === y) || (t[0] === y && t[t.length - 1] === x))) return false;
    for (let i = 0; i < t.length; i++) {
      const v = t[i];
      if (!Number.isInteger(v) || v < 0 || v >= n * n || used.has(v)) return false;
      used.add(v);
      if (i > 0) {
        const u = t[i - 1];
        if (Math.abs(Math.floor(u / n) - Math.floor(v / n)) + Math.abs((u % n) - (v % n)) !== 1) return false;
      }
    }
  }
  return used.size === n * n;
}
