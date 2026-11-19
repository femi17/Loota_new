/**
 * Fresh word puzzles written by Claude (owner, 19 Nov 2026: "The games are repeated, I thought we agreed that we use
 * anthropic api to generate new puzzle so we do not repeat"): the Key Trial's Grammar sentences and Lost Vowels
 * themes, easy (early keys) and hard (later keys).
 *
 * Claude Haiku 5.5 writes them (cheap: owner, 22 Oct 2026); Claude Sonnet 5.5 checks every one blind: it fills each
 * gap from the options shuffled, and solves each vowel-less word from its clue, and flags anything ambiguous or
 * doubtful. Only what it gets right, sure and unflagged, is kept; repeats of what's there already are dropped.
 * They're added to src/game/puzzles/more-grammar.ts and more-vowels.ts (shipped with the game: nothing at play time).
 *
 *   node scripts/generate-word-puzzles.mts                       # 150 easy + 100 hard sentences; 60 easy + 40 hard themes
 *   node scripts/generate-word-puzzles.mts --grammar 40 --vowels 0
 *   node scripts/generate-word-puzzles.mts --dry                 # write nothing, print what would be added
 *
 * Reads ANTHROPIC_API_KEY from .env.local.
 */
import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { GRAMMAR_ALL } from "../src/game/puzzles/grammar.ts";
import { VOWELS_ALL } from "../src/game/puzzles/vowels.ts";
import { MORE_GRAMMAR } from "../src/game/puzzles/more-grammar.ts";
import { MORE_VOWELS } from "../src/game/puzzles/more-vowels.ts";

process.loadEnvFile(".env.local");
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const GRAMMAR = arg("grammar", 150); // easy; hard is two thirds of it
const VOWEL_THEMES = arg("vowels", 60);
const DRY = process.argv.includes("--dry");
const WRITER = "claude-haiku-5-5";
const CHECKER = "claude-sonnet-5-5";
/** $ per million tokens, in and out. */
const PRICE: Record<string, [number, number]> = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] };

const claude = new Anthropic();
const spent = { dollars: 0 };

async function ask<T>(model: typeof WRITER | typeof CHECKER, system: string, user: string, schema: z.ZodType<T>, effort: "medium" | "high"): Promise<T | null> {
  const response = await claude.beta.messages.parse({
    model,
    max_tokens: 16000,
    ...(model === CHECKER ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  spent.dollars += (response.usage.input_tokens * PRICE[model][0] + response.usage.output_tokens * PRICE[model][1]) / 1e6;
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    console.log(`  (skipped: ${response.stop_reason})`);
    return null;
  }
  return response.parsed_output ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SAFE = "Plain, friendly English. Nothing about politics, religion, ethnic groups' traits, violence or tragedies.";

// ---- Grammar: [sentence with ___, the right word, the wrong ones]
type Gap = [string, string, string[]];
const GapsWritten = z.object({ items: z.array(z.object({ sentence: z.string(), right: z.string(), wrong: z.array(z.string()) })) });
const GapsChecked = z.object({ answers: z.array(z.object({ n: z.number().int(), choice: z.number().int(), sure: z.boolean(), problem: z.string().nullable() })) });
const LEVEL_GRAMMAR = {
  easy: `Everyday mix-ups people really make: their/there/they're, your/you're, its/it's, to/too/two, then/than, lose/loose,
fewer/less, who's/whose, affect/effect, advice/advise, practise/practice, a/an, much/many, was/were, bring/take, past/passed,
quiet/quite, accept/except, been/being, borrow/lend, and the like. Vary them: no more than a few sentences on any one pair.`,
  hard: `Harder points a careful writer gets right: who/whom, lie/lay, the subjunctive ("If I were"), inversion ("Hardly had
we…"), neither/nor agreement, between you and me, fewer/less with units, comprised of/composed of, compliment/complement,
principal/principle, stationary/stationery, discreet/discrete, imply/infer, born/borne, may/might in the past, each/every
agreement, and the like. Vary them.`,
};

function gapOk([s, right, wrong]: Gap) {
  return (
    (s.match(/___/g) ?? []).length === 1 &&
    s.length <= 100 &&
    right.length > 0 &&
    right.length <= 20 &&
    wrong.length >= 1 &&
    wrong.length <= 3 &&
    wrong.every((w) => w.length > 0 && w.length <= 20) &&
    new Set([right, ...wrong].map(norm)).size === 1 + wrong.length
  );
}

async function checkGaps(items: Gap[]): Promise<Gap[]> {
  const shuffled = items.map(([, right, wrong]) => [right, ...wrong].sort(() => Math.random() - 0.5));
  const listing = items.map(([s], n) => `${n}. ${s}\n${shuffled[n].map((o, i) => `   ${i}) ${o}`).join("\n")}`).join("\n\n");
  const r = await ask(
    CHECKER,
    "You check fill-the-gap grammar questions for a game before players see them.",
    `For each sentence, give the number of the option that correctly fills the gap (___) in standard English, whether you
are sure, and a problem if there is one: more than one option is acceptable (in British or American English, formal or
informal), none is right, it's a matter of style rather than grammar, the sentence is unnatural or unclear, or it's
inappropriate. Otherwise problem is null.

${listing}`,
    GapsChecked,
    "high",
  );
  if (!r) return [];
  const kept: Gap[] = [];
  for (const a of r.answers) {
    const g = items[a.n];
    if (!g) continue;
    const agreed = norm(shuffled[a.n][a.choice] ?? "") === norm(g[1]);
    if (agreed && a.sure && !a.problem) kept.push(g);
    else console.log(`  dropped: "${g[0]}"${a.problem ? ` (${a.problem})` : agreed ? " (not sure)" : " (answered differently)"}`);
  }
  return kept;
}

async function growGrammar(level: "easy" | "hard", want: number) {
  const have = new Set([...GRAMMAR_ALL[level], ...MORE_GRAMMAR[level]].map(([s]) => norm(s)));
  const recent = [...GRAMMAR_ALL[level]].map(([s]) => s);
  const added: Gap[] = [];
  for (let round = 0; added.length < want && round < Math.ceil(want / 25) + 3; round++) {
    const n = Math.min(25, want - added.length);
    console.log(`grammar · ${level}: writing ${n}…`);
    const w = await ask(
      WRITER,
      "You write fill-the-gap grammar questions for Loota, a treasure-hunt game played on phones, mostly in Nigeria.",
      `Write ${n} new sentences, each with one gap written ___ and the word or words that fill it: the one right answer
and one or two wrong ones (the mistakes people really make). Exactly one option is right in standard English, British
or American. The sentence at most 90 characters, about everyday life anywhere in the world (Nigeria now and then).
${LEVEL_GRAMMAR[level]}
${SAFE}
Don't repeat or closely rephrase these:
${recent.slice(-120).map((s) => `- ${s}`).join("\n")}`,
      GapsWritten,
      "medium",
    );
    if (!w) continue;
    const fresh = w.items.map((i) => [i.sentence.trim(), i.right.trim(), i.wrong.map((x) => x.trim())] as Gap).filter((g) => gapOk(g) && !have.has(norm(g[0])));
    for (const g of await checkGaps(fresh)) {
      if (have.has(norm(g[0]))) continue;
      have.add(norm(g[0]));
      recent.push(g[0]);
      added.push(g);
    }
    console.log(`  kept so far: ${added.length} · $${spent.dollars.toFixed(3)}`);
  }
  return added;
}

// ---- Lost Vowels: a theme, five words with clues
type Theme = { theme: string; words: [string, string][] };
const ThemesWritten = z.object({ themes: z.array(z.object({ theme: z.string(), words: z.array(z.object({ word: z.string(), clue: z.string() })) })) });
const WordsChecked = z.object({ answers: z.array(z.object({ n: z.number().int(), word: z.string(), sure: z.boolean(), problem: z.string().nullable() })) });
const VOWELS = /[AEIOU]/g;
const skeleton = (w: string) => w.replace(VOWELS, "_");
const LEVEL_VOWELS = {
  easy: "Words known the world over: everyday things, nature, sport, food, places, jobs, science basics.",
  hard: "Words that need knowing: history, science, the arts, geography, Africa and Nigeria, with clues that don't give them away.",
};

function wordOk(word: string, clue: string) {
  const letters = word.replace(/ /g, "");
  return (
    /^[A-Z]+( [A-Z]+)?$/.test(word) &&
    letters.length >= 4 &&
    letters.length <= 14 &&
    (letters.match(VOWELS) ?? []).length >= 1 &&
    letters.replace(VOWELS, "").length >= 2 &&
    clue.length > 0 &&
    clue.length <= 60 &&
    !norm(clue).includes(norm(word))
  );
}

async function checkThemes(themes: Theme[]): Promise<Theme[]> {
  const flat = themes.flatMap((t, ti) => t.words.map(([w, clue], wi) => ({ ti, wi, w, clue, theme: t.theme })));
  const listing = flat.map((x, n) => `${n}. Theme "${x.theme}" · ${skeleton(x.w)} (${x.w.replace(/ /g, "").length} letters) · clue: ${x.clue}`).join("\n");
  const r = await ask(
    CHECKER,
    "You check a word game before players see it: each word is shown with its vowels (A E I O U) replaced by _, with a theme and a clue.",
    `Solve each one: write the whole word in capitals (keep any space), whether you are sure, and a problem if there is
one: another word also fits the gaps, theme and clue; the clue is wrong, misleading or gives it away; the fact changes
over time or is doubtful; or it's inappropriate. Otherwise problem is null.

${listing}`,
    WordsChecked,
    "high",
  );
  if (!r) return [];
  const good = new Set<string>();
  for (const a of r.answers) {
    const x = flat[a.n];
    if (!x) continue;
    if (norm(a.word) === norm(x.w) && a.sure && !a.problem) good.add(`${x.ti}:${x.wi}`);
    else console.log(`  dropped: ${x.w} (${x.clue})${a.problem ? `: ${a.problem}` : norm(a.word) === norm(x.w) ? ": not sure" : `: solved as ${a.word}`}`);
  }
  return themes
    .map((t, ti) => ({ theme: t.theme, words: t.words.filter((_, wi) => good.has(`${ti}:${wi}`)) }))
    .filter((t) => t.words.length >= 4);
}

async function growVowels(level: "easy" | "hard", want: number) {
  const have = new Set([...VOWELS_ALL.easy, ...VOWELS_ALL.hard, ...MORE_VOWELS.easy, ...MORE_VOWELS.hard].map((t) => norm(t.theme)));
  const names = [...have];
  const added: Theme[] = [];
  for (let round = 0; added.length < want && round < Math.ceil(want / 8) + 3; round++) {
    const n = Math.min(8, want - added.length);
    console.log(`vowels · ${level}: writing ${n} themes…`);
    const w = await ask(
      WRITER,
      "You write Lost Vowels puzzles for Loota, a treasure-hunt game played on phones, mostly in Nigeria: a theme and five words; players see each word with its vowels gone and a short clue, and type the word.",
      `Write ${n} new themes, each with five words and a clue for each. ${LEVEL_VOWELS[level]}
Each word in capitals, 4 to 14 letters, one word or two (a space between), with at least one vowel and two consonants,
and only one word that fits its gaps, theme and clue. Facts that don't change. Each clue at most 50 characters, without
the word in it. ${SAFE}
New themes only, not these (or the same thing by another name):
${names.slice(-150).join("; ")}`,
      ThemesWritten,
      "medium",
    );
    if (!w) continue;
    const fresh: Theme[] = w.themes
      .map((t) => ({ theme: t.theme.trim(), words: t.words.map((x) => [x.word.trim().toUpperCase(), x.clue.trim()] as [string, string]).filter(([a, b]) => wordOk(a, b)).slice(0, 5) }))
      .filter((t) => t.words.length >= 4 && t.theme.length <= 40 && !have.has(norm(t.theme)));
    for (const t of await checkThemes(fresh)) {
      if (have.has(norm(t.theme))) continue;
      have.add(norm(t.theme));
      names.push(t.theme);
      added.push(t);
    }
    console.log(`  kept so far: ${added.length} · $${spent.dollars.toFixed(3)}`);
  }
  return added;
}

const grammar = { easy: [...MORE_GRAMMAR.easy], hard: [...MORE_GRAMMAR.hard] };
const vowels = { easy: [...MORE_VOWELS.easy], hard: [...MORE_VOWELS.hard] };
if (GRAMMAR > 0) {
  grammar.easy.push(...(await growGrammar("easy", GRAMMAR)));
  grammar.hard.push(...(await growGrammar("hard", Math.round((GRAMMAR * 2) / 3))));
}
if (VOWEL_THEMES > 0) {
  vowels.easy.push(...(await growVowels("easy", VOWEL_THEMES)));
  vowels.hard.push(...(await growVowels("hard", Math.round((VOWEL_THEMES * 2) / 3))));
}

const header = (what: string) => `/**
 * More ${what}, written by Claude Haiku and checked blind by Claude Sonnet (scripts/generate-word-puzzles.mts;
 * owner, 19 Nov 2026: "The games are repeated… use anthropic api to generate new puzzle so we do not repeat").
 * Made by the script: don't edit by hand.
 */
`;
const added = {
  grammar: grammar.easy.length - MORE_GRAMMAR.easy.length + grammar.hard.length - MORE_GRAMMAR.hard.length,
  vowels: vowels.easy.length - MORE_VOWELS.easy.length + vowels.hard.length - MORE_VOWELS.hard.length,
};
console.log(`\nAdded ${added.grammar} grammar sentences and ${added.vowels} vowel themes · cost $${spent.dollars.toFixed(3)}`);
if (DRY) {
  console.log(JSON.stringify({ grammar, vowels }, null, 1).slice(0, 4000));
} else {
  writeFileSync(
    "src/game/puzzles/more-grammar.ts",
    `${header("grammar sentences: [the sentence (___ for the gap), the right word, the wrong ones]")}export const MORE_GRAMMAR: { easy: [string, string, string[]][]; hard: [string, string, string[]][] } = ${JSON.stringify(grammar, null, 1)};\n`,
  );
  writeFileSync(
    "src/game/puzzles/more-vowels.ts",
    `${header("Lost Vowels themes, each with four or five [word, clue]")}export const MORE_VOWELS: { easy: { theme: string; words: [string, string][] }[]; hard: { theme: string; words: [string, string][] }[] } = ${JSON.stringify(vowels, null, 1)};\n`,
  );
}
