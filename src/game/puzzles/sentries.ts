/**
 * Sentries (a Key Trial puzzle, after LinkedIn's Queens and Netflix's Starstruck): the key's area is a grid cut into
 * coloured districts. Post one sentry in every row, every column and every district, and no two sentries may touch,
 * not even at a corner. Each puzzle has exactly one answer.
 */
import { seeded, type Rng } from "./rng.ts";

/** What the player sees: the grid's size and which district each square belongs to (row by row). */
export type SentriesPuzzle = { n: number; regions: number[] };
/** The answer: the column of the sentry in each row. */
export type SentriesAnswer = number[];

function placeSentries(n: number, rng: Rng): number[] | null {
  const cols: number[] = [];
  const used = new Set<number>();
  const go = (row: number): boolean => {
    if (row === n) return true;
    for (const c of rng.shuffle([...Array(n).keys()])) {
      if (used.has(c) || (row > 0 && Math.abs(c - cols[row - 1]) <= 1)) continue;
      cols.push(c);
      used.add(c);
      if (go(row + 1)) return true;
      cols.pop();
      used.delete(c);
    }
    return false;
  };
  return go(0) ? cols : null;
}

/** Districts grown outwards from each sentry's square, at random, until every square belongs to one. */
function growRegions(n: number, cols: number[], rng: Rng): number[] {
  const region = new Array<number>(n * n).fill(-1);
  const size = new Array<number>(n).fill(1);
  cols.forEach((c, r) => (region[r * n + c] = r));
  // Some districts stay small (that's what makes the answer unique), others sprawl.
  const appetite = [...Array(n).keys()].map(() => 0.15 + rng.next() * rng.next() * 3);
  let left = n * n - n;
  while (left > 0) {
    const options: [number, number][] = [];
    for (let i = 0; i < n * n; i++) {
      if (region[i] >= 0) continue;
      const r = Math.floor(i / n), c = i % n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const g = region[rr * n + cc];
        if (g >= 0) options.push([i, g]);
      }
    }
    const weights = options.map(([, g]) => appetite[g] / Math.sqrt(size[g]));
    let pick = rng.next() * weights.reduce((s, w) => s + w, 0);
    let k = 0;
    while (pick > weights[k] && k < weights.length - 1) pick -= weights[k++];
    const [cell, g] = options[k];
    region[cell] = g;
    size[g]++;
    left--;
  }
  return region;
}

/** The answers (up to `max`): rows top to bottom, each a column, a district and no neighbour above. */
export function solveSentries(p: SentriesPuzzle, max = 2): SentriesAnswer[] {
  const { n, regions } = p;
  const found: SentriesAnswer[] = [];
  const cols: number[] = [];
  const usedCol = new Array<boolean>(n).fill(false);
  const usedRegion = new Array<boolean>(n).fill(false);
  const go = (row: number) => {
    if (found.length >= max) return;
    if (row === n) {
      found.push([...cols]);
      return;
    }
    for (let c = 0; c < n; c++) {
      const g = regions[row * n + c];
      if (usedCol[c] || usedRegion[g] || (row > 0 && Math.abs(c - cols[row - 1]) <= 1)) continue;
      cols.push(c);
      usedCol[c] = usedRegion[g] = true;
      go(row + 1);
      cols.pop();
      usedCol[c] = usedRegion[g] = false;
    }
  };
  go(0);
  return found;
}

/** A puzzle with exactly one answer, `n` squares a side (7 to 9). */
export function makeSentries(seed: number, n: number): { puzzle: SentriesPuzzle; answer: SentriesAnswer } {
  const rng = seeded(seed);
  for (let tries = 0; tries < 5000; tries++) {
    const cols = placeSentries(n, rng);
    if (!cols) continue;
    const puzzle = { n, regions: growRegions(n, cols, rng) };
    const answers = solveSentries(puzzle, 2);
    if (answers.length === 1) return { puzzle, answer: answers[0] };
  }
  throw new Error(`No unique Sentries puzzle for seed ${seed}`);
}

/** Is this a right answer? Every rule checked (not compared with the stored answer). */
export function checkSentries(p: SentriesPuzzle, cells: number[][]): boolean {
  const { n, regions } = p;
  if (!Array.isArray(cells) || cells.length !== n) return false;
  const rows = new Set<number>(), cols = new Set<number>(), regs = new Set<number>();
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length !== 2) return false;
    const [r, c] = cell;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= n || c >= n) return false;
    rows.add(r);
    cols.add(c);
    regs.add(regions[r * n + c]);
  }
  if (rows.size !== n || cols.size !== n || regs.size !== n) return false;
  for (const [r, c] of cells) {
    for (const [r2, c2] of cells) {
      if ((r !== r2 || c !== c2) && Math.abs(r - r2) <= 1 && Math.abs(c - c2) <= 1) return false;
    }
  }
  return true;
}
