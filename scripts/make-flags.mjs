// The flags for "Guess the flag" (owner, 4 Nov 2026): copied from the flag-icons package (MIT, its licence copied
// alongside) into public/flags, each under a name of its own that doesn't say the country, with a map from country
// code to file for the game's server (src/game/puzzles/flag-files.ts).
//   node scripts/make-flags.mjs <folder of flag-icons' flags/4x3> <its LICENSE>
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [dir, licence] = process.argv.slice(2);
if (!dir || !licence) throw new Error("usage: node scripts/make-flags.mjs <flags/4x3 folder> <LICENSE>");
const src = readFileSync(new URL("../src/game/puzzles/countries.ts", import.meta.url), "utf8");
const codes = [...src.matchAll(/code: "([a-z]{2})"/g)].map((m) => m[1]);
const out = new URL("../public/flags/", import.meta.url);
mkdirSync(out, { recursive: true });
const files = {};
for (const code of codes) {
  const name = createHash("sha1").update(`loota-flag:${code}`).digest("hex").slice(0, 12);
  copyFileSync(`${dir}/${code}.svg`, new URL(`${name}.svg`, out));
  files[code] = `${name}.svg`;
}
copyFileSync(licence, new URL("LICENSE-flag-icons.txt", out));
writeFileSync(
  new URL("../src/game/puzzles/flag-files.ts", import.meta.url),
  `/** Each country's flag in public/flags, by its code (made by scripts/make-flags.mjs from flag-icons, MIT). */\nexport const FLAG_FILES: Record<string, string> = ${JSON.stringify(files, null, 2).replace(/"([a-z]{2})":/g, "$1:")};\n`,
);
console.log(`${codes.length} flags copied`);
