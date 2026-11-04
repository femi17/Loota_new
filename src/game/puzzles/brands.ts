/**
 * Guess the logo (owner, 4 Nov 2026: "guess the Logo or guess the brand"; "The guess the logo should be an image not
 * a word description"): three logos of brands known the world over, each with four brands to choose from. The logos
 * come from Simple Icons (scripts/make-logos.mjs: their names taken out, their file names don't say whose); they stay
 * their companies' marks. The answers stay on the game's server.
 */
import { seeded } from "./rng.ts";
import { LOGO_FILES } from "./logo-files.ts";

export type BrandsPuzzle = { items: { image: string; options: string[] }[] };
export type BrandsAnswer = number[];

const SLUGS = Object.keys(LOGO_FILES);

/** A puzzle of `count` logos (three: quick enough for a minute). */
export function makeBrands(seed: number, count = 3): { puzzle: BrandsPuzzle; answer: BrandsAnswer } {
  const rng = seeded(seed);
  const picked = rng.shuffle(SLUGS).slice(0, count);
  const items = picked.map((slug) => {
    const others = rng.shuffle(SLUGS.filter((s) => s !== slug)).slice(0, 3);
    const options = rng.shuffle([slug, ...others]).map((s) => LOGO_FILES[s].name);
    return { image: `/logos/${LOGO_FILES[slug].file}`, options, right: options.indexOf(LOGO_FILES[slug].name) };
  });
  return { puzzle: { items: items.map(({ image, options }) => ({ image, options })) }, answer: items.map((i) => i.right) };
}

/** Every logo named right. */
export function checkBrands(solution: BrandsAnswer, answer: BrandsAnswer) {
  return Array.isArray(answer) && answer.length === solution.length && answer.every((a, i) => Number(a) === solution[i]);
}
