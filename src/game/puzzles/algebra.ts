/**
 * Simple algebra (owner, 4 Nov 2026: "simple algebra"): three equations, find x in each (a whole number). Harder at
 * later keys: 3x + 4 = 19 at first, then 5x − 7 = 18, then 4(x + 3) = 28. The answers stay on the game's server.
 */
import { seeded } from "./rng.ts";

export type AlgebraPuzzle = { items: { equation: string }[] };
export type AlgebraAnswer = number[];

/** A puzzle of three equations at a level (1 to 3). */
export function makeAlgebra(seed: number, level = 1, count = 3): { puzzle: AlgebraPuzzle; answer: AlgebraAnswer } {
  const rng = seeded(seed);
  const items: { equation: string; x: number }[] = [];
  for (let k = 0; k < count; k++) {
    const x = 1 + rng.int(12);
    const a = 2 + rng.int(level >= 2 ? 8 : 4);
    const b = 1 + rng.int(level >= 2 ? 20 : 12);
    // A mix at the later keys; at the last ones, x on both sides and a division (owner, 8 Nov 2026: "not tasking").
    const kind = level <= 1 ? 0 : level === 2 ? [1, 2, 3][k % 3] : [3, 4, 2][k % 3];
    if (kind === 0) items.push({ equation: `${a}x + ${b} = ${a * x + b}`, x });
    else if (kind === 1) items.push({ equation: `${a}x − ${b} = ${a * x - b}`, x });
    else if (kind === 2) items.push({ equation: `${a}(x + ${b % 6 + 1}) = ${a * (x + (b % 6) + 1)}`, x });
    else if (kind === 3) {
      const c = 1 + rng.int(4);
      const d = (a + c) * x + b - c * x; // (a + c)x + b = cx + d
      items.push({ equation: `${a + c}x + ${b} = ${c === 1 ? "" : c}x + ${d}`, x });
    } else {
      const m = 2 + rng.int(4);
      const q = 2 + rng.int(8);
      const add = 1 + rng.int(m * q - 1); // (x + add) ÷ m = q, with x = m·q − add
      items.push({ equation: `(x + ${add}) ÷ ${m} = ${q}`, x: m * q - add });
    }
  }
  return { puzzle: { items: items.map(({ equation }) => ({ equation })) }, answer: items.map((i) => i.x) };
}

/** Every x right. */
export function checkAlgebra(solution: AlgebraAnswer, answer: AlgebraAnswer) {
  return Array.isArray(answer) && answer.length === solution.length && answer.every((a, i) => Number(a) === solution[i]);
}
