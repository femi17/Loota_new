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

/** The letters with fewest countries to choose from (seven to nine), for the last keys (owner, 8 Nov 2026: "not tasking"). */
const HARD_LETTERS = [..."EILU"].filter((l) => COUNTRIES.filter((c) => firstLetter(c) === l).length >= 7);
/** The letters with the most (S, M, B, C) are left out from level 2. */
const MID_LETTERS = LETTERS.filter((l) => !"SMBC".includes(l));

/** A letter, and how many to name (five, as the owner asked); harder letters at the later keys. */
export function makeCountries(seed: number, count = 5, level = 1): { puzzle: CountriesPuzzle; answer: CountriesAnswer } {
  const rng = seeded(seed);
  const letters = level >= 3 ? HARD_LETTERS : level === 2 ? MID_LETTERS : LETTERS;
  const letter = letters[rng.int(letters.length)];
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
