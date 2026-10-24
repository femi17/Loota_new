/**
 * Adire (a Key Trial puzzle, after LinkedIn's Tango): finish the dyer's cloth. Every square is indigo or white; each
 * row and column has as many of one as the other; never three alike side by side (across or down); and where a sign
 * sits between two squares, "=" means they're the same and "×" means they differ. Each puzzle has exactly one answer.
 */
import { seeded, type Rng } from "./rng.ts";

/** A sign between a square and the one to its right ("r") or below ("d"). */
export type AdireSign = { cell: number; dir: "r" | "d"; same: boolean };
/** What the player sees: the size, the squares already dyed (index → 0 white, 1 indigo) and the signs. */
export type AdirePuzzle = { n: number; given: Record<number, 0 | 1>; signs: AdireSign[] };
/** The answer: every square, row by row (0 white, 1 indigo). */
export type AdireAnswer = (0 | 1)[];

/** Do the squares so far (−1 = not yet) break a rule? Checks the row and column of square `i`. */
function breaks(n: number, g: Int8Array, i: number): boolean {
  const r = Math.floor(i / n), c = i % n;
  const half = n / 2;
  for (const line of [[...Array(n).keys()].map((k) => r * n + k), [...Array(n).keys()].map((k) => k * n + c)]) {
    let ones = 0, zeros = 0;
    for (let k = 0; k < n; k++) {
      const v = g[line[k]];
      if (v === 1) ones++;
      else if (v === 0) zeros++;
      if (k >= 2 && v >= 0 && v === g[line[k - 1]] && v === g[line[k - 2]]) return true;
    }
    if (ones > half || zeros > half) return true;
  }
  return false;
}

function fullCloth(n: number, rng: Rng): AdireAnswer | null {
  const g = new Int8Array(n * n).fill(-1);
  const go = (i: number): boolean => {
    if (i === n * n) return true;
    for (const v of rng.shuffle([0, 1])) {
      g[i] = v;
      if (!breaks(n, g, i) && go(i + 1)) return true;
    }
    g[i] = -1;
    return false;
  };
  return go(0) ? (Array.from(g) as AdireAnswer) : null;
}

/** The answers (up to `max`). */
export function solveAdire(p: AdirePuzzle, max = 2): AdireAnswer[] {
  const { n, given, signs } = p;
  const g = new Int8Array(n * n).fill(-1);
  const signsAt = new Map<number, AdireSign[]>(); // checked when the later square of the pair is filled
  for (const s of signs) {
    const other = s.dir === "r" ? s.cell + 1 : s.cell + n;
    signsAt.set(other, [...(signsAt.get(other) ?? []), s]);
  }
  const found: AdireAnswer[] = [];
  const go = (i: number) => {
    if (found.length >= max) return;
    if (i === n * n) {
      found.push(Array.from(g) as AdireAnswer);
      return;
    }
    const options = given[i] !== undefined ? [given[i]] : [0, 1];
    for (const v of options) {
      g[i] = v;
      if (breaks(n, g, i)) continue;
      const bad = (signsAt.get(i) ?? []).some((s) => (g[s.cell] === v) !== s.same);
      if (!bad) go(i + 1);
    }
    g[i] = -1;
  };
  go(0);
  return found;
}

/** A puzzle with exactly one answer, `n` squares a side (6 or 8); `clues`: about how many givens and signs to leave. */
export function makeAdire(seed: number, n = 6, clues = 10): { puzzle: AdirePuzzle; answer: AdireAnswer } {
  const rng = seeded(seed);
  for (let tries = 0; tries < 50; tries++) {
    const answer = fullCloth(n, rng);
    if (!answer) continue;
    // Start from everything given, then take clues away while the answer stays unique; now and then swap a given for
    // a sign beside it (signs make it a different kind of think).
    const given: Record<number, 0 | 1> = {};
    answer.forEach((v, i) => (given[i] = v));
    const signs: AdireSign[] = [];
    for (const cell of rng.shuffle([...Array(n * n).keys()])) {
      const v = given[cell];
      delete given[cell];
      if (solveAdire({ n, given, signs }, 2).length === 1) {
        // Removed for good; sometimes a sign takes its place to keep later removals possible.
        continue;
      }
      // It was needed: try a sign beside it instead of the square itself.
      const r = Math.floor(cell / n), c = cell % n;
      const options: AdireSign[] = [];
      if (c < n - 1) options.push({ cell, dir: "r", same: answer[cell] === answer[cell + 1] });
      if (r < n - 1) options.push({ cell, dir: "d", same: answer[cell] === answer[cell + n] });
      if (c > 0) options.push({ cell: cell - 1, dir: "r", same: answer[cell - 1] === answer[cell] });
      if (r > 0) options.push({ cell: cell - n, dir: "d", same: answer[cell - n] === answer[cell] });
      const sign = options.length && rng.next() < 0.6 ? options[rng.int(options.length)] : null;
      if (sign && !signs.some((s) => s.cell === sign.cell && s.dir === sign.dir)) {
        signs.push(sign);
        if (solveAdire({ n, given, signs }, 2).length === 1) continue;
        signs.pop();
      }
      given[cell] = v;
    }
    // Trim signs that aren't needed, down to about `clues` clues in all.
    for (const s of rng.shuffle([...signs])) {
      if (Object.keys(given).length + signs.length <= clues) break;
      const at = signs.indexOf(s);
      signs.splice(at, 1);
      if (solveAdire({ n, given, signs }, 2).length !== 1) signs.splice(at, 0, s);
    }
    return { puzzle: { n, given, signs }, answer };
  }
  throw new Error(`No unique Adire puzzle for seed ${seed}`);
}

/** Is this cloth right? Every rule checked, the givens kept and every sign obeyed. */
export function checkAdire(p: AdirePuzzle, cloth: number[]): boolean {
  const { n, given, signs } = p;
  if (!Array.isArray(cloth) || cloth.length !== n * n || cloth.some((v) => v !== 0 && v !== 1)) return false;
  const g = Int8Array.from(cloth);
  for (let i = 0; i < n * n; i++) if (breaks(n, g, i)) return false;
  for (const [cell, v] of Object.entries(given)) if (g[Number(cell)] !== v) return false;
  for (const s of signs) {
    const other = s.dir === "r" ? s.cell + 1 : s.cell + n;
    if ((g[s.cell] === g[other]) !== s.same) return false;
  }
  return true;
}
