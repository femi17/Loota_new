/**
 * Sudoku (a Key Trial puzzle, owner, 1 Nov 2026: "for the sudoku, we can half solved it and then let users complete
 * it"): a 9×9 grid about half filled in; fill the rest so every row, column and 3×3 box holds 1 to 9 once. Each
 * puzzle has exactly one answer.
 */
import { seeded } from "./rng.ts";

/** What the player sees: 81 squares row by row, 0 where they fill in. */
export type SudokuPuzzle = { given: number[] };
/** The answer: all 81 numbers. */
export type SudokuAnswer = number[];

const box = (i: number) => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);

/** Solutions (up to `max`), filling the square with the fewest choices first. */
export function solveSudoku(grid: number[], max = 2): number[][] {
  const g = [...grid];
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const bit = 1 << g[i];
    if (rows[Math.floor(i / 9)] & bit || cols[i % 9] & bit || boxes[box(i)] & bit) return [];
    rows[Math.floor(i / 9)] |= bit;
    cols[i % 9] |= bit;
    boxes[box(i)] |= bit;
  }
  const found: number[][] = [];
  const go = () => {
    if (found.length >= max) return;
    let best = -1, bestFree = 0, bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const free = ~(rows[Math.floor(i / 9)] | cols[i % 9] | boxes[box(i)]) & 0x3fe;
      let count = 0;
      for (let v = free; v; v &= v - 1) count++;
      if (count < bestCount) {
        best = i;
        bestFree = free;
        bestCount = count;
        if (count <= 1) break;
      }
    }
    if (best < 0) {
      found.push([...g]);
      return;
    }
    for (let d = 1; d <= 9; d++) {
      if (!(bestFree & (1 << d))) continue;
      const bit = 1 << d, r = Math.floor(best / 9), c = best % 9, b = box(best);
      g[best] = d;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      go();
      g[best] = 0;
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
      if (found.length >= max) return;
    }
  };
  go();
  return found;
}

/** A full grid at random, then squares emptied (in random order) while the answer stays the only one, down to `givens`. */
export function makeSudoku(seed: number, givens: number): { puzzle: SudokuPuzzle; answer: SudokuAnswer } {
  const rng = seeded(seed);
  // A full grid: the first row shuffled, then solved with the choices tried in a shuffled order.
  const start = new Array(81).fill(0);
  rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).forEach((d, c) => (start[c] = d));
  const full = solveSudoku(start, 1)[0];
  // Relabel the digits at random too (the first row's order is already random; this mixes the rest).
  const relabel = [0, ...rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])];
  const answer = full.map((d) => relabel[d]);
  const given = [...answer];
  let filled = 81;
  for (const i of rng.shuffle([...Array(81).keys()])) {
    if (filled <= givens) break;
    const keep = given[i];
    given[i] = 0;
    if (solveSudoku(given, 2).length !== 1) given[i] = keep;
    else filled--;
  }
  return { puzzle: { given }, answer };
}

/** Is this a right answer? Every rule checked, and the squares given left as they were. */
export function checkSudoku(p: SudokuPuzzle, a: number[]): boolean {
  if (!Array.isArray(a) || a.length !== 81) return false;
  if (a.some((d, i) => !Number.isInteger(d) || d < 1 || d > 9 || (p.given[i] && p.given[i] !== d))) return false;
  for (let k = 0; k < 9; k++) {
    const row = new Set<number>(), col = new Set<number>(), bx = new Set<number>();
    for (let j = 0; j < 9; j++) {
      row.add(a[k * 9 + j]);
      col.add(a[j * 9 + k]);
      bx.add(a[(Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3)]);
    }
    if (row.size !== 9 || col.size !== 9 || bx.size !== 9) return false;
  }
  return true;
}
