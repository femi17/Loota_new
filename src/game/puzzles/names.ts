/** The Key Trial puzzles' names and rules, for the phone (the puzzles themselves are made on the server). */
export type PuzzleKind = "sentries" | "route" | "adire" | "tornmap" | "sudoku" | "threads" | "plots" | "patchwork" | "vowels" | "grammar" | "algebra" | "countries" | "flags" | "brands";

export const PUZZLE_NAMES: Record<PuzzleKind, { name: string; rule: string }> = {
  sentries: {
    name: "Sentries",
    rule: "Post one sentry in every row, every column and every coloured district. No two sentries may touch, not even at a corner.",
  },
  route: {
    name: "Route",
    rule: "Draw one route through every square, passing the numbers in order from 1. Move up, down, left or right; never through a wall.",
  },
  tornmap: {
    name: "Torn Map",
    rule: "The map of these very streets was torn to pieces. Tap a piece, then another, to swap them; at the hardest keys tap a chosen piece again to turn it. Put the map back together.",
  },
  sudoku: {
    name: "Sudoku",
    rule: "Half of it is done. Fill in the rest: every row, every column and every 3×3 box holds 1 to 9, each once.",
  },
  threads: {
    name: "Threads",
    rule: "Join each pair of matching beads with one thread. Threads never cross or share a square, and together they fill every square.",
  },
  plots: {
    name: "Plots",
    rule: "Divide the land into rectangular plots. Each plot holds exactly one number: how many squares it covers. Drag from corner to corner to mark a plot.",
  },
  patchwork: {
    name: "Patchwork",
    rule: "Fill the outline with every patch: no gaps, no overlaps. Pick a patch, turn it if you need to, then tap where its marked square goes.",
  },
  grammar: {
    name: "Grammar",
    rule: "Each sentence has a gap. Pick the word that fills it correctly.",
  },
  algebra: {
    name: "Algebra",
    rule: "Find x in each equation (a whole number), and type it in.",
  },
  countries: {
    name: "Name the countries",
    rule: "Type countries that start with the letter. Any will do, as long as each is a real country and none twice.",
  },
  flags: {
    name: "Guess the flag",
    rule: "Whose flag is it? Pick the country for each one.",
  },
  brands: {
    name: "Guess the logo",
    rule: "Whose logo is it? Pick the brand for each one.",
  },
  vowels: {
    name: "Lost Vowels",
    rule: "The vowels have fallen out of these words. Read the theme and the clues, and type each word in full.",
  },
  adire: {
    name: "Adire",
    rule: "Dye every square indigo or white. Each row and column has as many of each; never three alike side by side. = means the same, × means different.",
  },
};
