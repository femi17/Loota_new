/**
 * Name the countries (owner, 4 Nov 2026: "type 5 coutries starting with L"): a letter, and five countries to type
 * that start with it (any five: it's checked against the world's list, src/game/puzzles/countries.ts). Only letters
 * with at least eight countries are asked, so there's always a choice.
 */
import { seeded } from "./rng.ts";
import { COUNTRIES, countryFor, firstLetter } from "./countries.ts";

export type CountriesPuzzle = { letter: string; count: number };
export type CountriesAnswer = string[];

const LETTERS = [..."ABCEGILMNPST"].filter((l) => COUNTRIES.filter((c) => firstLetter(c) === l).length >= 8);

/** A letter, and how many to name (five, as the owner asked). */
export function makeCountries(seed: number, count = 5): { puzzle: CountriesPuzzle; answer: CountriesAnswer } {
  const rng = seeded(seed);
  const letter = LETTERS[rng.int(LETTERS.length)];
  return { puzzle: { letter, count }, answer: COUNTRIES.filter((c) => firstLetter(c) === letter).slice(0, count).map((c) => c.name) };
}

/** Enough different countries, each starting with the letter (whatever spelling the player used). */
export function checkCountries(p: CountriesPuzzle, answer: CountriesAnswer) {
  if (!Array.isArray(answer)) return false;
  const codes = new Set<string>();
  for (const typed of answer) {
    const c = typeof typed === "string" ? countryFor(typed, p.letter) : null;
    if (c) codes.add(c.code);
  }
  return codes.size >= p.count;
}
