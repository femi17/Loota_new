/**
 * Guess the flag (owner, 4 Nov 2026: "guess the flag"): three flags, each with four countries to choose from. The
 * flags are well-known ones from all over the world; their pictures' file names don't say the country
 * (scripts/make-flags.mjs), and the answers stay on the game's server.
 */
import { seeded } from "./rng.ts";
import { COUNTRIES } from "./countries.ts";
import { FLAG_FILES } from "./flag-files.ts";

export type FlagsPuzzle = { items: { image: string; options: string[] }[] };
export type FlagsAnswer = number[];

/** Flags many people know, from every continent. */
const KNOWN = [
  "ng", "gh", "ke", "za", "eg", "ma", "et", "sn", "cm", "ci", "tz", "ug", "dz", "tn", "jm", "br", "ar", "mx", "ca", "us",
  "co", "cl", "pe", "cu", "gb", "fr", "de", "it", "es", "pt", "nl", "be", "ch", "se", "no", "dk", "fi", "ie", "gr", "pl",
  "ua", "ru", "tr", "cn", "jp", "kr", "in", "pk", "bd", "id", "ph", "vn", "th", "my", "sg", "sa", "ae", "il", "ir", "au",
  "nz", "ve", "uy", "at", "hu", "cz", "ro", "is", "lb", "np",
];

/** A puzzle of `count` flags (three: quick enough for a minute). */
export function makeFlags(seed: number, count = 3): { puzzle: FlagsPuzzle; answer: FlagsAnswer } {
  const rng = seeded(seed);
  const name = (code: string) => COUNTRIES.find((c) => c.code === code)!.name;
  const picked = rng.shuffle(KNOWN).slice(0, count);
  const items = picked.map((code) => {
    const others = rng.shuffle(KNOWN.filter((c) => c !== code)).slice(0, 3);
    const options = rng.shuffle([code, ...others]).map(name);
    return { image: `/flags/${FLAG_FILES[code]}`, options, right: options.indexOf(name(code)) };
  });
  return { puzzle: { items: items.map(({ image, options }) => ({ image, options })) }, answer: items.map((i) => i.right) };
}

/** Every flag named right. */
export function checkFlags(solution: FlagsAnswer, answer: FlagsAnswer) {
  return Array.isArray(answer) && answer.length === solution.length && answer.every((a, i) => Number(a) === solution[i]);
}
