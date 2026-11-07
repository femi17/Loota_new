/**
 * The Key Trial puzzles (owner, 24 Oct 2026): which puzzle, how big at each level (1 for early keys, 3 for the last),
 * made from a seed, and checked by their rules. Used by the game's server only (/api/trial/puzzle, /api/trial/solve):
 * answers never go to the phone.
 */
import { checkAdire, makeAdire, type AdirePuzzle } from "./adire.ts";
import { checkRoute, makeRoute, type RoutePuzzle } from "./route.ts";
import { checkSentries, makeSentries, type SentriesPuzzle } from "./sentries.ts";
import { checkTornMap, type TornMapAnswer, type TornMapPuzzle } from "./tornmap.ts";
import { checkSudoku, makeSudokuOneEach, type SudokuPuzzle } from "./sudoku.ts";
import { checkThreads, makeThreads, type ThreadsPuzzle } from "./threads.ts";
import { checkPlots, makePlots, type PlotsAnswer, type PlotsPuzzle } from "./plots.ts";
import { checkPatchwork, makePatchwork, type PatchworkPlacement, type PatchworkPuzzle } from "./patchwork.ts";
import { checkVowels, makeVowels, type VowelsAnswer, type VowelsPuzzle } from "./vowels.ts";
import { checkGrammar, makeGrammar, type GrammarPuzzle } from "./grammar.ts";
import { checkAlgebra, makeAlgebra, type AlgebraPuzzle } from "./algebra.ts";
import { checkCountries, makeCountries, type CountriesPuzzle } from "./namecountries.ts";
import { checkFlags, makeFlags, type FlagsPuzzle } from "./flags.ts";
import { checkBrands, makeBrands, type BrandsPuzzle } from "./brands.ts";
import type { PuzzleKind } from "./names.ts";

export { PUZZLE_NAMES, type PuzzleKind } from "./names.ts";

export type AnyPuzzle = SentriesPuzzle | RoutePuzzle | AdirePuzzle | TornMapPuzzle | SudokuPuzzle | ThreadsPuzzle | PlotsPuzzle | PatchworkPuzzle | VowelsPuzzle | GrammarPuzzle | AlgebraPuzzle | CountriesPuzzle | FlagsPuzzle | BrandsPuzzle;

/** The puzzles picked now (owner, 4 Nov 2026: "Remove this sentrie game, replace with something else"): every kind but
 * Sentries (kept only so a trial already under way can finish) and the Torn Map (it needs the streets: the Key Trial
 * makes it itself). */
export const PICKED_KINDS: PuzzleKind[] = ["route", "adire", "sudoku", "threads", "plots", "patchwork", "vowels", "grammar", "algebra", "countries", "flags", "brands"];

/** The puzzle for a kind and level (1–3), from a seed. */
export function makePuzzle(kind: PuzzleKind, level: number, seed: number): { puzzle: AnyPuzzle; answer: unknown } {
  const l = Math.max(1, Math.min(3, Math.round(level || 1)));
  if (kind === "tornmap") throw new Error("A Torn Map needs its streets: makeTornMap with drawingAround");
  // Every puzzle fair in 60 seconds (owner, 3 Nov 2026: "each puzzle time should be 60"): small boards, with enough
  // given that there's no guessing and the hand has time (scripts/tests/puzzle-sixty-check.mts checks each kind).
  if (kind === "sentries") return makeSentries(seed, [6, 6, 7][l - 1]);
  // One empty square in each box (owner, 7 Nov 2026: "one cell removed from every cell … Just 1"): 72 of 81 given.
  if (kind === "sudoku") return makeSudokuOneEach(seed);
  if (kind === "threads") return makeThreads(seed, [5, 5, 6][l - 1], [4, 5, 5][l - 1]);
  if (kind === "plots") return makePlots(seed, [5, 5, 6][l - 1], [6, 7, 8][l - 1]);
  if (kind === "patchwork") return makePatchwork(seed, [4, 4, 5][l - 1]);
  if (kind === "vowels") return makeVowels(seed, [3, 3, 4][l - 1]);
  // The quick ones (owner, 4 Nov 2026: "grammar, simple algebra, type 5 coutries starting with L, guess the flag, …
  // guess the brand")
  if (kind === "grammar") return makeGrammar(seed, 4);
  if (kind === "algebra") return makeAlgebra(seed, l, 3);
  if (kind === "countries") return makeCountries(seed, 5);
  if (kind === "flags") return makeFlags(seed, 3);
  if (kind === "brands") return makeBrands(seed, 3);
  if (kind === "route") {
    const [n, keep] = ([[5, 8], [5, 7], [6, 9]] as const)[l - 1];
    return makeRoute(seed, n, keep);
  }
  return makeAdire(seed, 6, [10, 8, 6][l - 1], [20, 18, 16][l - 1]);
}

/**
 * Is this answer right, by the puzzle's rules? (Sentries: [row, col] pairs; Route: squares in order; Adire: the cloth.)
 * Lost Vowels is checked against its stored words (`solution`): the puzzle on the phone doesn't hold them.
 */
export function checkPuzzle(kind: PuzzleKind, puzzle: AnyPuzzle, answer: unknown, solution?: unknown): boolean {
  try {
    if (kind === "sudoku") return checkSudoku(puzzle as SudokuPuzzle, answer as number[]);
    if (kind === "threads") return checkThreads(puzzle as ThreadsPuzzle, answer as number[][]);
    if (kind === "plots") return checkPlots(puzzle as PlotsPuzzle, answer as PlotsAnswer);
    if (kind === "patchwork") return checkPatchwork(puzzle as PatchworkPuzzle, answer as PatchworkPlacement[]);
    if (kind === "vowels") return checkVowels(solution as VowelsAnswer, answer as string[]);
    if (kind === "grammar") return checkGrammar(solution as number[], answer as number[]);
    if (kind === "algebra") return checkAlgebra(solution as number[], answer as number[]);
    if (kind === "countries") return checkCountries(puzzle as CountriesPuzzle, answer as string[]);
    if (kind === "flags") return checkFlags(solution as number[], answer as number[]);
    if (kind === "brands") return checkBrands(solution as number[], answer as number[]);
    if (kind === "sentries") return checkSentries(puzzle as SentriesPuzzle, answer as number[][]);
    if (kind === "route") return checkRoute(puzzle as RoutePuzzle, answer as number[]);
    if (kind === "tornmap") return checkTornMap(puzzle as TornMapPuzzle, answer as TornMapAnswer);
    return checkAdire(puzzle as AdirePuzzle, answer as number[]);
  } catch {
    return false;
  }
}
