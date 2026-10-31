// The Loota story engine (owner, 30 Oct 2026: "an engine or a prompt we can always deploy every day to give us a
// compelling treasure hunt story line"). One run makes one complete story hunt:
//   1. picks a genre, a theme, and for each key a puzzle lock and a live channel, the least recently used, so no two
//      days feel the same (library.mts);
//   2. Claude plans the story (BIBLE.md is its brief), then writes 20+ decoys per key, then every chapter;
//   3. checks it: codes decoded by computer, every answer and decoy found on the map, no key place named in the text,
//      and an AI attack (a second model tries to find the places without the live pieces: it should fail; with them:
//      it should succeed);
//   4. writes docs/stories/<date>-<slug>/: story.pdf (for players), answers.pdf (for you), story.json, report.md,
//      and records everything used in docs/stories/registry.json so no later story repeats it.
//
//   node scripts/story-engine/engine.mts [--keys 5] [--writer sonnet|opus] [--genre "spy thriller"] [--theme "..."]
//                                        [--start "West Africa"] [--date 2026-10-31] [--dry]
// Needs ANTHROPIC_API_KEY in .env.local. Takes about 10–20 minutes; the report says what it cost.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CHANNELS, LOCKS, GENRES, THEMES } from "./library.mts";

process.loadEnvFile(".env.local");
const argv = process.argv;
const opt = (name: string, fallback: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const KEYS = Number(opt("keys", "5"));
/** Chapters between the prologue and the epilogue: room for every key's plants and payoffs (about one more than the keys, 6 at least). */
const CHAPTERS = Math.max(6, KEYS + 1);
const WRITER = opt("writer", "sonnet") === "opus" ? "claude-opus-5-5" : "claude-sonnet-5-5";
const SOLVER = "claude-sonnet-5-5";
const DATE = opt("date", new Date().toISOString().slice(0, 10));
const DRY = argv.includes("--dry");
const DIR = "docs/stories";
const REGISTRY = `${DIR}/registry.json`;
/** $ per million tokens, in and out (as in generate-questions.mts). Opus is reported in tokens only. */
const PRICE: Record<string, [number, number]> = { "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
/** An answer this close counts as found; a decoy this close to the answer is a second answer, not a decoy. */
const FOUND_M = 1500;
const DECOY_GAP_M = 1000;

// ---- The registry: everything already used ------------------------------------------------------------------------
type Used = {
  date: string; slug: string; title: string; genre: string; theme: string; locks: string[]; channels: string[];
  places: { name: string; lng: number; lat: number }[]; decoys: string[]; characters: string[];
};
const registry: { stories: Used[] } = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, "utf8")) : { stories: [] };

/** The `count` items used longest ago (never-used first), shuffled among equals. */
function leastRecent<T extends { id: string }>(items: T[], usedIn: (s: Used) => string[], count: number): T[] {
  const last = new Map<string, number>();
  registry.stories.forEach((s, i) => usedIn(s).forEach((id) => last.set(id, i)));
  const order = [...items].map((it) => ({ it, at: last.get(it.id) ?? -1, r: Math.random() })).sort((a, b) => a.at - b.at || a.r - b.r).map((x) => x.it);
  // More keys than kinds: go round again, least used first (never the same kind twice in a row).
  return Array.from({ length: count }, (_, i) => order[i % order.length]);
}
// Work in progress, saved after every step: running the same command again carries on where it stopped
// (a failed step costs only itself). --fresh starts over.
const WORK = `${DIR}/.work-${DATE}.json`;
const work: Record<string, unknown> = existsSync(WORK) && !argv.includes("--fresh") ? JSON.parse(readFileSync(WORK, "utf8")) : {};
const saveWork = () => writeFileSync(WORK, JSON.stringify(work, null, 2));
/** A step's result: from the work file if done before, else computed now and saved. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (name in work) return work[name] as T;
  const value = await run();
  work[name] = value;
  saveWork();
  return value;
}

const recentGenres = registry.stories.slice(-3).map((s) => s.genre);
const usedThemes = new Set(registry.stories.map((s) => s.theme));
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const picked = (work.picked as { genre: string; theme: string; locks: string[]; channels: string[] } | undefined) ?? {
  genre: opt("genre", pick(GENRES.filter((g) => !recentGenres.includes(g))) ?? pick(GENRES)),
  theme: opt("theme", pick(THEMES.filter((t) => !usedThemes.has(t))) ?? pick(THEMES)),
  locks: leastRecent(LOCKS, (s) => s.locks, KEYS).map((l) => l.id),
  channels: leastRecent(CHANNELS, (s) => s.channels, KEYS).map((c) => c.id),
};
const { genre, theme } = picked;
const assignment = picked.locks.map((id, i) => ({ n: i + 1, lock: LOCKS.find((l) => l.id === id)!, channel: CHANNELS.find((c) => c.id === picked.channels[i])! }));
if (!DRY) {
  work.picked = picked;
  saveWork();
}

console.log(`Story for ${DATE}: ${genre}, "${theme}", ${KEYS} keys, written by ${WRITER}`);
for (const a of assignment) console.log(`  key ${a.n}: lock ${a.lock.name} · live piece by ${a.channel.name}${a.channel.game === "to-build" ? " (game feature to build)" : ""}`);
if (DRY) process.exit(0);

// ---- Claude --------------------------------------------------------------------------------------------------------
const BIBLE = readFileSync("scripts/story-engine/BIBLE.md", "utf8");
const claude = new Anthropic();
const spent: Record<string, { input: number; output: number }> = {};

async function ask<T>(model: string, system: string, user: string, schema: z.ZodType<T>, effort: "medium" | "high", label: string): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await claude.beta.messages.parse({
        model,
        max_tokens: 20000, // the most a request may ask for without streaming
        // Later tries think less, leaving more of the answer's room for the answer itself.
        output_config: { effort: attempt === 1 ? effort : "low", format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content: user }],
      });
    } catch (e) {
      // An answer cut off mid-way can't be read; anything else is a real error.
      if (!/parse structured output/i.test(String(e))) throw e;
      console.log(`  (${label}: the answer was cut off, trying again)`);
      continue;
    }
    const s = (spent[model] ??= { input: 0, output: 0 });
    s.input += response.usage.input_tokens;
    s.output += response.usage.output_tokens;
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens" && response.parsed_output) return response.parsed_output;
    console.log(`  (${label}: ${response.stop_reason}, trying again)`);
  }
  throw new Error(`${label}: no usable answer from ${model}`);
}

// ---- Stage 1: the blueprint ----------------------------------------------------------------------------------------
const Blueprint = z.object({
  title: z.string(),
  logline: z.string(),
  villain: z.object({ name: z.string(), motive: z.string() }),
  heroes: z.array(z.object({ name: z.string(), role: z.string() })),
  worldRules: z.array(z.string()).describe("Rules careful players learn and use, e.g. how to tell a forgery from a true letter."),
  chapters: z.array(z.object({
    n: z.number().describe("0 = prologue; the last is the epilogue"),
    title: z.string(),
    setting: z.string().describe("Shown under the chapter title. Never names a key place: say 'Somewhere by a river', 'A cold November morning'."),
    beats: z.array(z.string()),
    plants: z.array(z.string()).describe("Details planted here that pay off later, and for which key."),
  })),
  keys: z.array(z.object({
    n: z.number(),
    question: z.string().describe("The question the game asks, e.g. 'Where did Isoken fly?' Never contains the answer."),
    answer: z.object({
      name: z.string(),
      searchName: z.string().describe("The name that finds it on OpenStreetMap, e.g. 'Belem Tower' or 'Igun Street, Benin City'"),
      city: z.string(),
      country: z.string(),
      aliases: z.array(z.string()).describe("Other names and spellings players may type"),
    }),
    lockId: z.string(),
    channelId: z.string(),
    conditions: z.array(z.string()).describe("The conditions only the true answer meets, all of them"),
  })),
});
/** A key's full design, planned one key at a time (a whole five-key plan in one answer runs out of room). */
const KeyDesign = z.object({
  solveSteps: z.array(z.string()),
  plants: z.array(z.object({ chapter: z.number(), detail: z.string() })),
  livePiece: z.object({
    where: z.string().describe("Where in the game the player gets it"),
    when: z.string().describe("When it can be got (hours Lagos time, once, every hour…)"),
    content: z.string().describe("Exactly what the player sees or hears, in full"),
    perPlayer: z.boolean().describe("True if each player gets a different version"),
  }),
  check: z.object({
    kind: z.enum(["none", "acrostic", "caesar", "anagram"]),
    lines: z.array(z.string()).describe("Acrostic: the sentences, in order. Otherwise []"),
    cipher: z.string().describe("Caesar or anagram: the letters as shown to players. Otherwise ''"),
    shift: z.number().describe("Caesar: how many letters back to decode (negative = forward). Otherwise 0"),
    plain: z.string().describe("What it decodes to, exactly (letters only matter)"),
  }),
});
type Blueprint = Omit<z.infer<typeof Blueprint>, "keys"> & { keys: (z.infer<typeof Blueprint>["keys"][number] & z.infer<typeof KeyDesign>)[] };

const used = {
  places: registry.stories.flatMap((s) => s.places.map((p) => p.name)),
  decoys: registry.stories.flatMap((s) => s.decoys).slice(-400),
  characters: registry.stories.flatMap((s) => s.characters),
  titles: registry.stories.map((s) => s.title),
};
const brief = `Design a new Loota story hunt.

Genre: ${genre}
Theme: ${theme}
Number of keys: ${KEYS}
${argv.includes("--start") ? `Where the story begins: ${opt("start", "")}\n` : ""}
The keys, in order, with the lock (the kind of puzzle) and the channel (how the live piece reaches players) each must use:
${assignment.map((a) => `- Key ${a.n}: lock "${a.lock.id}" (${a.lock.name}: ${a.lock.how}); channel "${a.channel.id}" (${a.channel.name}: ${a.channel.how})`).join("\n")}

Already used (never reuse any of these):
- Places: ${used.places.join("; ") || "none yet"}
- Decoys: ${used.decoys.join("; ") || "none yet"}
- Characters: ${used.characters.join("; ") || "none yet"}
- Titles: ${used.titles.join("; ") || "none yet"}

Plan the story's skeleton now: title, characters, world rules, prologue, ${CHAPTERS} chapters and an epilogue (number the prologue 0) with their beats and plants, and every key's question, answer and conditions. Keep beats and plants short: one line each. Spread the keys around the world. Make every answer a precise real place (a street, building, bridge, square, market) that exists on OpenStreetMap. Each key's detailed design, and the decoys, come in the next steps.`;

console.log("Planning the story…");
const skeleton = await step("skeleton", () => ask(WRITER, BIBLE, brief, Blueprint, "medium", "blueprint"));
console.log(`  "${skeleton.title}": ${skeleton.chapters.length} chapters, ${skeleton.keys.length} keys`);
const designed = [];
for (const key of skeleton.keys) {
  console.log(`Designing key ${key.n}…`);
  const a = assignment.find((x) => x.n === key.n) ?? assignment[0];
  const design = await step(`key-${key.n}`, () => ask(WRITER, BIBLE, `The story's plan:\n${JSON.stringify(skeleton)}\n\nDesign key ${key.n} in full ("${key.question}", answer: ${key.answer.name}). Its lock: ${a.lock.name} (${a.lock.how}). Its channel: ${a.channel.name} (${a.channel.how}). Give the solving steps, the plants (chapter and detail), the live piece written out in full, and, if the lock has a mechanical part (acrostic, letter shift, anagram), the exact check data. The story alone must not solve it; story plus live piece must.`, KeyDesign, "medium", `key ${key.n}`));
  designed.push({ ...key, ...design });
}
const blueprint: Blueprint = { ...skeleton, keys: designed };

// ---- Stage 2: decoys, key by key -----------------------------------------------------------------------------------
const Decoys = z.object({
  decoys: z.array(z.object({
    place: z.string(),
    searchName: z.string().describe("The name that finds it on OpenStreetMap"),
    type: z.enum(["A", "B", "C"]),
    tempting: z.string().describe("Why a player (or an AI) would pick it"),
    fails: z.string().describe("Which of the key's conditions it fails"),
    chapter: z.number().describe("The chapter it is woven into"),
    how: z.string().describe("How it appears in that chapter, naturally (a memory, a remark, a forged letter…)"),
  })),
});
type Decoy = z.infer<typeof Decoys>["decoys"][number];
const decoys = new Map<number, Decoy[]>();
for (const key of blueprint.keys) {
  console.log(`Decoys for key ${key.n}…`);
  const r = await step(`decoys-${key.n}`, () => ask(WRITER, BIBLE, `The story so far (plan):\n${JSON.stringify(blueprint)}\n\nWrite at least 22 decoys for key ${key.n} ("${key.question}", true answer: ${key.answer.name}). Real places only, each at least 1 km from the true answer, each failing at least one of the key's conditions: ${key.conditions.join("; ")}. Mix types A, B and C. Spread them over several chapters, woven in naturally, never as a list. Never reuse: ${used.decoys.join("; ") || "none"}.`, Decoys, "medium", `decoys ${key.n}`));
  decoys.set(key.n, r.decoys);
}

// ---- Stage 3: checks before writing --------------------------------------------------------------------------------
const letters = (s: string) => s.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();
const shiftBack = (s: string, n: number) => s.replace(/[A-Za-z]/g, (c) => String.fromCharCode(((c.toUpperCase().charCodeAt(0) - 65 - n) % 26 + 26) % 26 + 65));
const codeChecks = blueprint.keys.map((k) => {
  const c = k.check;
  if (c.kind === "acrostic") {
    const got = c.lines.map((l) => letters(l)[0] ?? "").join("");
    return { n: k.n, kind: c.kind, ok: got === letters(c.plain), detail: `first letters spell ${got}, should spell ${letters(c.plain)}` };
  }
  if (c.kind === "caesar") {
    const got = shiftBack(c.cipher, c.shift);
    return { n: k.n, kind: c.kind, ok: letters(got) === letters(c.plain), detail: `${c.cipher} shifted ${c.shift} back gives ${got}, should give ${c.plain}` };
  }
  if (c.kind === "anagram") {
    const sort = (s: string) => [...letters(s)].sort().join("");
    return { n: k.n, kind: c.kind, ok: sort(c.cipher) === sort(c.plain), detail: `${c.cipher} vs ${c.plain}` };
  }
  return { n: k.n, kind: c.kind, ok: true, detail: "nothing to compute" };
});
for (const c of codeChecks) console.log(`  code check, key ${c.n} (${c.kind}): ${c.ok ? "ok" : "WRONG"}: ${c.detail}`);

type Spot = { name: string; lng: number; lat: number };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function photon(q: string): Promise<Spot | null> {
  await wait(300); // the public map search's fair use
  try {
    const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Loota story engine" }, signal: AbortSignal.timeout(20_000) });
    const f = ((await res.json()) as { features: { properties: { name?: string; city?: string; country?: string }; geometry: { coordinates: [number, number] } }[] }).features[0];
    if (!f) return null;
    return { name: [f.properties.name, f.properties.city, f.properties.country].filter(Boolean).join(", "), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  } catch {
    return null;
  }
}
const metres = (a: Spot, b: Spot) => {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.round(Math.hypot(x, y) * 6371000);
};

console.log("Checking places on the map…");
const spots = new Map<number, Spot | null>();
const mapChecks: { n: number; answer: string; found: Spot | null; aliases: { alias: string; ok: boolean; got: string }[]; decoys: { place: string; ok: boolean; why: string }[] }[] = [];
for (const key of blueprint.keys) {
  const found = (await photon(key.answer.searchName)) ?? (await photon(`${key.answer.name}, ${key.answer.city}`));
  spots.set(key.n, found);
  const aliases = [];
  for (const alias of key.answer.aliases) {
    const got = await photon(alias);
    aliases.push({ alias, ok: !!(found && got && metres(found, got) <= FOUND_M), got: got?.name ?? "nothing" });
  }
  const checked = [];
  for (const d of decoys.get(key.n) ?? []) {
    const got = await photon(d.searchName);
    const gap = found && got ? metres(found, got) : null;
    checked.push({ place: d.place, ok: !!got && (gap === null || gap >= DECOY_GAP_M), why: !got ? "not found on the map" : gap !== null && gap < DECOY_GAP_M ? `only ${gap} m from the answer` : "ok" });
  }
  mapChecks.push({ n: key.n, answer: key.answer.name, found, aliases, decoys: checked });
  console.log(`  key ${key.n}: answer ${found ? `found (${found.name})` : "NOT FOUND"}; aliases ${aliases.filter((a) => a.ok).length}/${aliases.length}; decoys on the map ${checked.filter((c) => c.ok).length}/${checked.length}`);
}

// ---- Stage 4: the chapters -----------------------------------------------------------------------------------------
const Chapter = z.object({ text: z.string().describe("The chapter's prose. Paragraphs separated by a blank line. No headings.") });
const secret = blueprint.keys.flatMap((k) => [k.answer.name, ...k.answer.aliases]).filter((s) => s.length > 3);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const leaks = (text: string) => secret.filter((s) => fold(text).includes(fold(s)));
const chapters: { n: number; title: string; setting: string; text: string; leaks: string[] }[] = [];
const decoyNotes = [...decoys].map(([n, list]) => `Key ${n} decoys: ${list.map((d) => `[ch ${d.chapter}] ${d.place}: ${d.how}`).join(" | ")}`).join("\n");
for (const ch of blueprint.chapters) {
  console.log(`Writing chapter ${ch.n}: ${ch.title}…`);
  const before = chapters.at(-1)?.text.slice(-1500) ?? "(this is the beginning)";
  const brief = `The plan:\n${JSON.stringify(blueprint)}\n\nDecoys to weave in:\n${decoyNotes}\n\nWrite chapter ${ch.n}, "${ch.title}" (${ch.setting}). Its beats: ${ch.beats.join("; ")}. Its plants: ${ch.plants.join("; ")}. Weave in every decoy assigned to chapter ${ch.n}, naturally. 900 to 1,400 words.\n\nThe previous chapter ended:\n${before}\n\nNever write any of these names: ${secret.join("; ")}. Never write a key's live piece content (it reaches players only in the game).`;
  const written = await step(`chapter-${ch.n}`, async () => {
    let { text } = await ask(WRITER, BIBLE, brief, Chapter, "medium", `chapter ${ch.n}`);
    let found = leaks(text);
    if (found.length) {
      console.log(`  it named ${found.join(", ")}: rewriting once`);
      ({ text } = await ask(WRITER, BIBLE, `${brief}\n\nYour last version named ${found.join(", ")}. Rewrite it without them:\n${text}`, Chapter, "medium", `chapter ${ch.n} again`));
      found = leaks(text);
    }
    return { text, found };
  });
  chapters.push({ n: ch.n, title: ch.title, setting: ch.setting, text: written.text, leaks: written.found });
}

// ---- Stage 5: the production pack (pictures and voices) -------------------------------------------------------------
const Production = z.object({
  style: z.string().describe("One art direction for every picture"),
  characters: z.array(z.object({ name: z.string(), look: z.string().describe("Fixed appearance to paste into every prompt") })),
  pictures: z.array(z.object({ chapter: z.number(), prompt: z.string().describe("A full image prompt; no text in the image; never shows a key place recognisably") })),
  voices: z.array(z.object({ name: z.string(), direction: z.string().describe("Voice for ElevenLabs: age, accent, pace, mood") })),
});
console.log("Picture prompts and voices…");
const production = await step("production", () => ask(WRITER, BIBLE, `The plan:\n${JSON.stringify(blueprint)}\n\nWrite the production pack: 3 picture prompts per chapter for ChatGPT (16:9, cinematic painted style, consistent characters), a fixed look for each character, and a voice direction for the narrator, each speaking character and each live piece's voice.`, Production, "medium", "production"));

// ---- Stage 6: the AI attack ----------------------------------------------------------------------------------------
const storyText = chapters.map((c) => `${c.title}\n${c.setting}\n\n${c.text}`).join("\n\n");
const Solved = z.object({ keys: z.array(z.object({ n: z.number(), place: z.string(), city: z.string(), country: z.string(), reasoning: z.string() })) });
const solverBrief = (withLive: boolean) => `This is a treasure-hunt story. Find the exact real-world place (street or building, city, country) for each question.\n\n${blueprint.keys.map((k) => `Key ${k.n}: ${k.question}`).join("\n")}\n\n${withLive ? `Extra evidence the game gave players:\n${blueprint.keys.map((k) => `Key ${k.n}: ${k.livePiece.content}`).join("\n")}\n\n` : ""}The story:\n\n${storyText}`;
async function attack(withLive: boolean) {
  const r = await step(withLive ? "attack-with" : "attack-without", () => ask(SOLVER, "You are an expert puzzle solver and geographer.", solverBrief(withLive), Solved, "high", withLive ? "attack with live pieces" : "attack without live pieces"));
  const out = [];
  for (const key of blueprint.keys) {
    const guess = r.keys.find((g) => g.n === key.n);
    const spot = guess ? await photon(`${guess.place}, ${guess.city}, ${guess.country}`) : null;
    const truth = spots.get(key.n);
    const gap = spot && truth ? metres(spot, truth) : null;
    out.push({ n: key.n, guess: guess ? `${guess.place}, ${guess.city}` : "no answer", solved: gap !== null && gap <= FOUND_M, gap });
  }
  return out;
}
console.log("AI attack: solving without the live pieces…");
const without = await attack(false);
console.log("AI attack: solving with the live pieces…");
const withLive = await attack(true);
for (const key of blueprint.keys) {
  const a = without.find((x) => x.n === key.n)!;
  const b = withLive.find((x) => x.n === key.n)!;
  console.log(`  key ${key.n}: without live piece ${a.solved ? "SOLVED (too easy)" : "not solved (good)"}; with it ${b.solved ? "solved (fair)" : "NOT solved (unfair or too hard)"}`);
}

// ---- Stage 7: write it all out -------------------------------------------------------------------------------------
const slug = blueprint.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
const out = `${DIR}/${DATE}-${slug}`;
mkdirSync(out, { recursive: true });
const cost = Object.entries(spent).map(([m, s]) => {
  const p = PRICE[m];
  return `${m}: ${s.input.toLocaleString()} tokens in, ${s.output.toLocaleString()} out${p ? `, about $${((s.input * p[0] + s.output * p[1]) / 1e6).toFixed(2)}` : ""}`;
});
const verdict = {
  codes: codeChecks.every((c) => c.ok),
  answersOnMap: mapChecks.every((m) => !!m.found),
  noLeaks: chapters.every((c) => c.leaks.length === 0),
  aiFailsWithout: without.every((a) => !a.solved),
  aiSolvesWith: withLive.every((a) => a.solved),
};
writeFileSync(`${out}/story.json`, JSON.stringify({ date: DATE, genre, theme, writer: WRITER, assignment: assignment.map((a) => ({ n: a.n, lock: a.lock.id, channel: a.channel.id })), blueprint, decoys: Object.fromEntries(decoys), chapters, production, checks: { codeChecks, mapChecks, without, withLive, verdict }, cost }, null, 2));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (t: string) => t.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("\n");
const style = readFileSync("scripts/story-engine/style.css", "utf8");
const storyHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(blueprint.title)}</title><style>${style}</style></head><body class="story">
<div class="cover"><h1>${esc(blueprint.title)}</h1><div class="sub">A Loota treasure hunt in ${KEYS} keys</div><p class="how">${esc(blueprint.logline)}<br><br>Everything you need is in this story, and in the game. ${KEYS} places are hidden in it, somewhere in the world.</p></div>
${chapters.map((c) => `<section><h2>${esc(c.title)}</h2><p class="where">${esc(c.setting)}</p>${paras(c.text)}</section>`).join("\n")}
<p class="end">THE END</p></body></html>`;
const tick = (ok: boolean) => (ok ? '<b class="ok">✓</b>' : '<b class="bad">✗</b>');
const answersHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(blueprint.title)}: answers</title><style>${style}</style></head><body class="answers">
<div class="secret">ANSWERS · DO NOT SHARE WITH PLAYERS</div>
<h1>${esc(blueprint.title)}</h1>
<p>${esc(genre)} · ${esc(theme)} · ${DATE} · written by ${WRITER}</p>
<div class="verdict">
<p>${tick(verdict.codes)} Codes decode exactly</p>
<p>${tick(verdict.answersOnMap)} Every answer is on the map</p>
<p>${tick(verdict.noLeaks)} No key place named in the story</p>
<p>${tick(verdict.aiFailsWithout)} An AI with the story alone can't find the places</p>
<p>${tick(verdict.aiSolvesWith)} An AI with the story and the live pieces can (it's fair)</p>
</div>
<h3>World rules players can learn</h3><ul>${blueprint.worldRules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
${blueprint.keys.map((k) => {
  const a = assignment.find((x) => x.n === k.n)!;
  const m = mapChecks.find((x) => x.n === k.n)!;
  const w = without.find((x) => x.n === k.n)!;
  const l = withLive.find((x) => x.n === k.n)!;
  const ds = decoys.get(k.n) ?? [];
  return `<div class="key"><h2>🗝️ ${k.n}. ${esc(k.question)}</h2>
<p class="ans">${esc(k.answer.name)} · ${esc(k.answer.city)}, ${esc(k.answer.country)}</p>
<p><b>Lock:</b> ${esc(a.lock.name)} · <b>Live piece:</b> ${esc(a.channel.name)}${a.channel.game === "to-build" ? " <i>(game feature to build)</i>" : ""}</p>
<p><b>Conditions only the answer meets:</b></p><ul>${k.conditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
<p><b>How it's solved:</b></p><ol>${k.solveSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<p><b>Planted:</b> ${k.plants.map((p) => `ch ${p.chapter}: ${esc(p.detail)}`).join(" · ")}</p>
<div class="live"><b>The live piece</b> (${esc(k.livePiece.where)}; ${esc(k.livePiece.when)}${k.livePiece.perPlayer ? "; different for every player" : ""}):<br>${esc(k.livePiece.content)}</div>
<p><b>Checks:</b> map ${m.found ? `found (${esc(m.found.name)})` : "NOT FOUND"} · aliases ${m.aliases.filter((x) => x.ok).length}/${m.aliases.length} · AI without live piece: ${w.solved ? '<b class="bad">solved it</b>' : "failed"} (${esc(w.guess)}) · with it: ${l.solved ? "solved" : '<b class="bad">failed</b>'}</p>
<p><b>${ds.length} decoys:</b></p><table><tr><th>Place</th><th>Type</th><th>Why tempting</th><th>Fails</th><th>Map</th></tr>${ds.map((d) => {
    const c = m.decoys.find((x) => x.place === d.place);
    return `<tr><td>${esc(d.place)} <span class="small">(ch ${d.chapter})</span></td><td>${d.type}</td><td>${esc(d.tempting)}</td><td>${esc(d.fails)}</td><td>${c?.ok ? "✓" : `<b class="bad">${esc(c?.why ?? "?")}</b>`}</td></tr>`;
  }).join("")}</table></div>`;
}).join("\n")}
<h3>Pictures (ChatGPT)</h3><p><b>Style:</b> ${esc(production.style)}</p>
<ul>${production.characters.map((c) => `<li><b>${esc(c.name)}:</b> ${esc(c.look)}</li>`).join("")}</ul>
<ol>${production.pictures.map((p) => `<li><span class="small">ch ${p.chapter}</span> ${esc(p.prompt)}</li>`).join("")}</ol>
<h3>Voices (ElevenLabs)</h3><ul>${production.voices.map((v) => `<li><b>${esc(v.name)}:</b> ${esc(v.direction)}</li>`).join("")}</ul>
<p class="small">Cost: ${cost.map(esc).join("; ")}</p>
</body></html>`;
writeFileSync(`${out}/story.html`, storyHtml);
writeFileSync(`${out}/answers.html`, answersHtml);

const app = createRequire(new URL("../../package.json", import.meta.url));
const puppeteer = app("puppeteer-core");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
for (const name of ["story", "answers"]) {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(`${out}/${name}.html`).href, { waitUntil: "networkidle0" });
  await page.pdf({ path: `${out}/${name}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true });
}
await browser.close();

writeFileSync(`${out}/report.md`, `# ${blueprint.title}\n\n${genre} · ${theme} · ${DATE}\n\n${Object.entries(verdict).map(([k, v]) => `- ${v ? "PASS" : "FAIL"} ${k}`).join("\n")}\n\n${cost.map((c) => `- ${c}`).join("\n")}\n`);

registry.stories.push({
  date: DATE, slug, title: blueprint.title, genre, theme,
  locks: assignment.map((a) => a.lock.id), channels: assignment.map((a) => a.channel.id),
  places: blueprint.keys.map((k) => ({ name: k.answer.name, lng: spots.get(k.n)?.lng ?? 0, lat: spots.get(k.n)?.lat ?? 0 })),
  decoys: [...decoys.values()].flat().map((d) => d.place),
  characters: [...blueprint.heroes.map((h) => h.name), blueprint.villain.name],
});
writeFileSync(REGISTRY, JSON.stringify(registry, null, 2));

console.log(`\nWritten to ${out}/ (story.pdf, answers.pdf, story.json, report.md)`);
for (const [k, v] of Object.entries(verdict)) console.log(`  ${v ? "PASS" : "FAIL"} ${k}`);
for (const c of cost) console.log(`  ${c}`);
