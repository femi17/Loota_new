/** The Key Trial puzzles' names and rules, for the phone (the puzzles themselves are made on the server). */
export type PuzzleKind = "sentries" | "route" | "adire";

export const PUZZLE_NAMES: Record<PuzzleKind, { name: string; rule: string }> = {
  sentries: {
    name: "Sentries",
    rule: "Post one sentry in every row, every column and every coloured district. No two sentries may touch, not even at a corner.",
  },
  route: {
    name: "Route",
    rule: "Draw one route through every square, passing the numbers in order from 1. Move up, down, left or right; never through a wall.",
  },
  adire: {
    name: "Adire",
    rule: "Dye every square indigo or white. Each row and column has as many of each; never three alike side by side. = means the same, × means different.",
  },
};
