/**
 * Patchwork (a Key Trial puzzle, owner, 1 Nov 2026, after the tangram-style "fit the shapes" puzzles): an outline on a
 * grid and a pile of patches. Turn and place every patch so the outline is filled exactly: no gaps, no overlaps.
 * Made by cutting the outline into patches; any answer that fills it with every patch is right.
 */
import { seeded, type Rng } from "./rng.ts";

type Cell = [number, number];
/** What the player sees: the grid's size, the outline's squares, and the patches (each its squares, turned at random). */
export type PatchworkPuzzle = { n: number; target: number[]; pieces: Cell[][] };
/** The answer: for each patch, how many quarter turns (clockwise) and where its first square goes. */
export type PatchworkPlacement = { piece: number; turns: number; r: number; c: number };

/** A patch's squares turned a quarter turn `turns` times, moved so its top row and left column start at 0, sorted. */
export function turned(cells: Cell[], turns: number): Cell[] {
  let out = cells.map(([r, c]) => [r, c] as Cell);
  for (let k = 0; k < ((turns % 4) + 4) % 4; k++) out = out.map(([r, c]) => [c, -r] as Cell);
  const r0 = Math.min(...out.map(([r]) => r)), c0 = Math.min(...out.map(([, c]) => c));
  return out.map(([r, c]) => [r - r0, c - c0] as Cell).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
/** The squares a placed patch covers: its first (top-left-most) square at (r, c). */
export function placedCells(cells: Cell[], turns: number, r: number, c: number): Cell[] {
  const t = turned(cells, turns);
  const [fr, fc] = t[0];
  return t.map(([a, b]) => [a - fr + r, b - fc + c] as Cell);
}

/** The outline: the n×n square with a few squares taken off its edges (still in one piece). */
function outline(n: number, rng: Rng): Set<number> {
  const cells = new Set([...Array(n * n).keys()]);
  const bites = rng.int(n - 1);
  for (let k = 0; k < bites; k++) {
    const edge = rng.int(4);
    const at = rng.int(n);
    const i = edge === 0 ? at : edge === 1 ? (n - 1) * n + at : edge === 2 ? at * n : at * n + n - 1;
    cells.delete(i);
  }
  return cells;
}

/** The outline cut into patches of 3 to 5 squares, grown at random from scattered starting squares. */
function cutPatches(n: number, target: Set<number>, rng: Rng): number[][] | null {
  const owner = new Map<number, number>();
  const cells = [...target];
  const count = Math.max(2, Math.round(cells.length / 4));
  const seeds = rng.shuffle(cells).slice(0, count);
  seeds.forEach((s, k) => owner.set(s, k));
  const size = new Array(count).fill(1);
  for (let stuck = 0; owner.size < cells.length && stuck < 500; stuck++) {
    const k = rng.int(count);
    if (size[k] >= 5) continue;
    const mine = cells.filter((i) => owner.get(i) === k);
    const next = rng.shuffle(mine.flatMap((i) => {
      const r = Math.floor(i / n), c = i % n;
      return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n).map(([a, b]) => a * n + b);
    }).filter((j) => target.has(j) && !owner.has(j)));
    if (!next.length) continue;
    owner.set(next[0], k);
    size[k]++;
    stuck = 0;
  }
  if (owner.size < cells.length || size.some((s) => s < 2)) return null;
  return [...Array(count).keys()].map((k) => cells.filter((i) => owner.get(i) === k));
}

/** A puzzle `n` squares a side. */
export function makePatchwork(seed: number, n: number): { puzzle: PatchworkPuzzle; answer: PatchworkPlacement[] } {
  const rng = seeded(seed);
  for (let tries = 0; tries < 300; tries++) {
    const target = outline(n, rng);
    const patches = cutPatches(n, target, rng);
    if (!patches) continue;
    const pieces: Cell[][] = [];
    const answer: PatchworkPlacement[] = [];
    rng.shuffle([...patches.keys()]).forEach((k, piece) => {
      const own = patches[k].map((i) => [Math.floor(i / n), i % n] as Cell);
      const spin = rng.int(4);
      const shown = turned(own, spin);
      pieces.push(shown);
      // Turning it back (4 − spin) puts it as it was cut: its first square where the cut patch's first square is.
      const home = turned(own, 0);
      const r0 = Math.min(...own.map(([r]) => r)), c0 = Math.min(...own.map(([, c]) => c));
      answer.push({ piece, turns: (4 - spin) % 4, r: home[0][0] + r0, c: home[0][1] + c0 });
    });
    return { puzzle: { n, target: [...target].sort((a, b) => a - b), pieces }, answer };
  }
  throw new Error(`No Patchwork puzzle for seed ${seed}`);
}

/** Is this a right answer? Every patch placed once, inside the outline, no overlaps, the outline filled. */
export function checkPatchwork(p: PatchworkPuzzle, a: PatchworkPlacement[]): boolean {
  if (!Array.isArray(a) || a.length !== p.pieces.length) return false;
  const target = new Set(p.target);
  const used = new Set<number>(), seen = new Set<number>();
  for (const x of a) {
    if (!x || !Number.isInteger(x.piece) || !Number.isInteger(x.turns) || !Number.isInteger(x.r) || !Number.isInteger(x.c)) return false;
    if (x.piece < 0 || x.piece >= p.pieces.length || seen.has(x.piece)) return false;
    seen.add(x.piece);
    for (const [r, c] of placedCells(p.pieces[x.piece], x.turns, x.r, x.c)) {
      if (r < 0 || c < 0 || r >= p.n || c >= p.n) return false;
      const i = r * p.n + c;
      if (!target.has(i) || used.has(i)) return false;
      used.add(i);
    }
  }
  return used.size === target.size;
}
