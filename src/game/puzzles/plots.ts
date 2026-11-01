/**
 * Plots (a Key Trial puzzle, owner, 1 Nov 2026, after the "divide into rectangles" puzzles): a piece of land with
 * numbers on it. Divide it into rectangular plots, each holding exactly one number, which is how many squares the plot
 * covers. Each puzzle has exactly one answer.
 */
import { seeded, type Rng } from "./rng.ts";

/** What the player sees: the grid's size and its numbers (square → number). */
export type PlotsPuzzle = { n: number; clues: Record<number, number> };
/** The answer: the plots, each [top row, left column, bottom row, right column]. */
export type PlotsAnswer = [number, number, number, number][];

/** The land cut into rectangles at random (2 to `most` squares each; a single square only where nothing else fits). */
function cut(n: number, most: number, rng: Rng): PlotsAnswer {
  const taken = new Array<boolean>(n * n).fill(false);
  const plots: PlotsAnswer = [];
  for (let i = 0; i < n * n; i++) {
    if (taken[i]) continue;
    const r = Math.floor(i / n), c = i % n;
    const options: [number, number][] = [];
    for (let h = 1; r + h <= n; h++) {
      for (let w = 1; c + w <= n; w++) {
        if (h * w > most) break;
        let free = true;
        for (let rr = r; rr < r + h && free; rr++) for (let cc = c; cc < c + w && free; cc++) if (taken[rr * n + cc]) free = false;
        if (!free) break;
        if (h * w >= 2) options.push([h, w]);
      }
    }
    const [h, w] = options.length ? options[rng.int(options.length)] : [1, 1];
    for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) taken[rr * n + cc] = true;
    plots.push([r, c, r + h - 1, c + w - 1]);
  }
  return plots;
}

/** Answers (up to `max`): for each number, the rectangles of its size holding it and no other number. */
export function solvePlots(p: PlotsPuzzle, max = 2): PlotsAnswer[] {
  const { n, clues } = p;
  const cells = Object.keys(clues).map(Number);
  const options = cells.map((cell) => {
    const size = clues[cell];
    const r0 = Math.floor(cell / n), c0 = cell % n;
    const out: [number, number, number, number][] = [];
    for (let h = 1; h <= size; h++) {
      if (size % h) continue;
      const w = size / h;
      for (let top = r0 - h + 1; top <= r0; top++) {
        for (let left = c0 - w + 1; left <= c0; left++) {
          if (top < 0 || left < 0 || top + h > n || left + w > n) continue;
          let alone = true;
          for (const other of cells) {
            if (other === cell) continue;
            const r = Math.floor(other / n), c = other % n;
            if (r >= top && r < top + h && c >= left && c < left + w) alone = false;
          }
          if (alone) out.push([top, left, top + h - 1, left + w - 1]);
        }
      }
    }
    return out;
  });
  const order = [...cells.keys()].sort((a, b) => options[a].length - options[b].length);
  const taken = new Array<boolean>(n * n).fill(false);
  const chosen: PlotsAnswer = new Array(cells.length);
  const found: PlotsAnswer[] = [];
  const mark = ([t, l, b, r]: number[], on: boolean) => {
    for (let rr = t; rr <= b; rr++) for (let cc = l; cc <= r; cc++) taken[rr * n + cc] = on;
  };
  const free = ([t, l, b, r]: number[]) => {
    for (let rr = t; rr <= b; rr++) for (let cc = l; cc <= r; cc++) if (taken[rr * n + cc]) return false;
    return true;
  };
  const go = (k: number) => {
    if (found.length >= max) return;
    if (k === order.length) {
      found.push([...chosen]);
      return;
    }
    const i = order[k];
    for (const rect of options[i]) {
      if (!free(rect)) continue;
      mark(rect, true);
      chosen[i] = rect;
      go(k + 1);
      mark(rect, false);
    }
  };
  go(0);
  return found;
}

/** A puzzle `n` squares a side, plots of up to `most` squares, with exactly one answer. */
export function makePlots(seed: number, n: number, most: number): { puzzle: PlotsPuzzle; answer: PlotsAnswer } {
  const rng = seeded(seed);
  for (let tries = 0; tries < 400; tries++) {
    const plots = cut(n, most, rng);
    if (plots.some(([t, l, b, r]) => (b - t + 1) * (r - l + 1) === 1) && tries < 300) continue;
    const clues: Record<number, number> = {};
    for (const [t, l, b, r] of plots) {
      const cell = (t + rng.int(b - t + 1)) * n + (l + rng.int(r - l + 1));
      clues[cell] = (b - t + 1) * (r - l + 1);
    }
    const puzzle = { n, clues };
    if (solvePlots(puzzle, 2).length === 1) {
      // The answer in the same order as the numbers (square order), for the record.
      const cells = Object.keys(clues).map(Number);
      const answer = cells.map((cell) => plots.find(([t, l, b, r]) => Math.floor(cell / n) >= t && Math.floor(cell / n) <= b && cell % n >= l && cell % n <= r)!);
      return { puzzle, answer };
    }
  }
  throw new Error(`No unique Plots puzzle for seed ${seed}`);
}

/** Is this a right answer? Rectangles inside the land, not overlapping, covering it, each with one number its size. */
export function checkPlots(p: PlotsPuzzle, a: PlotsAnswer): boolean {
  const { n, clues } = p;
  if (!Array.isArray(a)) return false;
  const taken = new Array<boolean>(n * n).fill(false);
  for (const rect of a) {
    if (!Array.isArray(rect) || rect.length !== 4 || rect.some((v) => !Number.isInteger(v))) return false;
    const [t, l, b, r] = rect;
    if (t < 0 || l < 0 || b >= n || r >= n || t > b || l > r) return false;
    let numbers = 0, value = 0;
    for (let rr = t; rr <= b; rr++) {
      for (let cc = l; cc <= r; cc++) {
        const i = rr * n + cc;
        if (taken[i]) return false;
        taken[i] = true;
        if (clues[i] !== undefined) {
          numbers++;
          value = clues[i];
        }
      }
    }
    if (numbers !== 1 || value !== (b - t + 1) * (r - l + 1)) return false;
  }
  return taken.every(Boolean);
}
