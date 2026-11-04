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
    const kind = level <= 1 ? 0 : level === 2 ? k % 2 : k % 3; // a mix at the later keys
    if (kind === 0) items.push({ equation: `${a}x + ${b} = ${a * x + b}`, x });
    else if (kind === 1) items.push({ equation: `${a}x − ${b} = ${a * x - b}`, x });
    else items.push({ equation: `${a}(x + ${b % 6 + 1}) = ${a * (x + (b % 6) + 1)}`, x });
  }
  return { puzzle: { items: items.map(({ equation }) => ({ equation })) }, answer: items.map((i) => i.x) };
}

/** Every x right. */
export function checkAlgebra(solution: AlgebraAnswer, answer: AlgebraAnswer) {
  return Array.isArray(answer) && answer.length === solution.length && answer.every((a, i) => Number(a) === solution[i]);
}
