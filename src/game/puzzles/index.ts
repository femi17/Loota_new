/**
 * The Key Trial puzzles (owner, 24 Oct 2026): which puzzle, how big at each level (1 for early keys, 3 for the last),
 * made from a seed, and checked by their rules. Used by the game's server only (/api/trial/puzzle, /api/trial/solve):
 * answers never go to the phone.
 */
import { checkAdire, makeAdire, type AdirePuzzle } from "./adire.ts";
import { checkRoute, makeRoute, type RoutePuzzle } from "./route.ts";
import { checkSentries, makeSentries, type SentriesPuzzle } from "./sentries.ts";
import { checkTornMap, type TornMapAnswer, type TornMapPuzzle } from "./tornmap.ts";
import type { PuzzleKind } from "./names.ts";

export { PUZZLE_NAMES, type PuzzleKind } from "./names.ts";

export type AnyPuzzle = SentriesPuzzle | RoutePuzzle | AdirePuzzle | TornMapPuzzle;

/** The puzzle for a kind and level (1–3), from a seed. */
export function makePuzzle(kind: PuzzleKind, level: number, seed: number): { puzzle: AnyPuzzle; answer: unknown } {
  const l = Math.max(1, Math.min(3, Math.round(level || 1)));
  if (kind === "tornmap") throw new Error("A Torn Map needs its streets: makeTornMap with drawingAround");
  if (kind === "sentries") return makeSentries(seed, [7, 8, 9][l - 1]);
  if (kind === "route") {
    const [n, keep] = ([[6, 8], [7, 9], [7, 7]] as const)[l - 1];
    return makeRoute(seed, n, keep);
  }
  return makeAdire(seed, 6, [10, 8, 6][l - 1]);
}

/** Is this answer right, by the puzzle's rules? (Sentries: [row, col] pairs; Route: squares in order; Adire: the cloth.) */
export function checkPuzzle(kind: PuzzleKind, puzzle: AnyPuzzle, answer: unknown): boolean {
  try {
    if (kind === "sentries") return checkSentries(puzzle as SentriesPuzzle, answer as number[][]);
    if (kind === "route") return checkRoute(puzzle as RoutePuzzle, answer as number[]);
    if (kind === "tornmap") return checkTornMap(puzzle as TornMapPuzzle, answer as TornMapAnswer);
    return checkAdire(puzzle as AdirePuzzle, answer as number[]);
  } catch {
    return false;
  }
}
