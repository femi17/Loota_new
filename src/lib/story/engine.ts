/**
 * The story engine (owner, 30–31 Oct 2026: "an engine … we can always deploy every day to give us a compelling treasure
 * hunt story line"). It writes one story hunt in small steps, each saved in a Work record, so it can run one step per
 * request in the admin (the live server stops any request after a few minutes) or in a loop on the command line
 * (scripts/story-engine/engine.mts). The order: pick the genre, theme, locks and channels (least used first) → plan the
 * story → design each key → 22+ decoys per key → check the codes → check every place on the map → write each chapter
 * (no key place may be named) → picture prompts and voices → an AI attack without the live pieces (should fail) and
 * with them (should succeed). BIBLE (bible.ts) is the brief; library.ts the locks, channels, genres and themes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { BIBLE } from "./bible";
import { CHANNELS, GENRES, LOCKS, THEMES } from "./library";

export const WRITERS = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" } as const;
const SOLVER = "claude-sonnet-5-5";
/** $ per million tokens, in and out. Opus is reported in tokens only. */
const PRICE: Record<string, [number, number]> = { "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
/** An answer this close counts as found; a decoy this close to its answer is a second answer, not a decoy. */
export const FOUND_M = 1500;
const DECOY_GAP_M = 1000;

/** What one story used (the registry: no later story reuses its places, decoys, characters or title). */
export type Used = {
  title: string; genre: string | null; theme: string | null; locks: string[]; channels: string[];
  places: { name: string; lng: number; lat: number }[]; decoys: string[]; characters: string[];
};

// ---- The shapes Claude answers in --------------------------------------------------------------------------------
const Skeleton = z.object({
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
const Chapter = z.object({ text: z.string().describe("The chapter's prose. Paragraphs separated by a blank line. No headings.") });
const Production = z.object({
  style: z.string().describe("One art direction for every picture"),
  characters: z.array(z.object({ name: z.string(), look: z.string().describe("Fixed appearance to paste into every prompt") })),
  pictures: z.array(z.object({ chapter: z.number(), prompt: z.string().describe("A full, self-contained image prompt: style, characters' looks, scene; no text in the image; never shows a key place recognisably") })).describe("The trailer's pictures: 3 (ChatGPT makes 3 a day; owner, 31 Oct 2026)"),
  voices: z.array(z.object({ name: z.string(), direction: z.string().describe("Voice for ElevenLabs: age, accent, pace, mood") })),
  trailer: z.object({
    voiceOver: z.string().describe("The trailer's voice-over script, about 45 seconds, one line per speaker: [NARRATOR] …, [CHARACTER] …"),
    shots: z.array(z.object({ picture: z.number().describe("1, 2 or 3"), lines: z.string().describe("The voice-over lines heard over this picture") })),
  }).optional().describe("The trailer the owner makes: the 3 pictures cut to this voice-over (ElevenLabs)"),
});
/** The shapes a story is made of: also used to check a story written in Claude Code before it is imported. */
export const STORY_SHAPES = { Skeleton, KeyDesign, Decoys, Production };
const Solved = z.object({ keys: z.array(z.object({ n: z.number(), place: z.string(), city: z.string(), country: z.string(), reasoning: z.string() })) });

export type SkeletonT = z.infer<typeof Skeleton>;
export type KeyDesignT = z.infer<typeof KeyDesign>;
export type DecoyT = z.infer<typeof Decoys>["decoys"][number];
export type ProductionT = z.infer<typeof Production>;
export type Spot = { name: string; lng: number; lat: number };
export type MapCheck = { answer: string; found: Spot | null; aliases: { alias: string; ok: boolean; got: string }[]; decoys: { place: string; ok: boolean; why: string }[] };
export type CodeCheck = { n: number; kind: string; ok: boolean; detail: string };
export type Attack = { n: number; guess: string; solved: boolean; gap: number | null };

/** A story in the making: every step's result, saved after each step. */
export type Work = {
  keys: number;
  writer: string;
  /** A genre or theme the owner asked for (otherwise picked). */
  wish?: { genre?: string; theme?: string };
  picked?: { genre: string; theme: string; locks: string[]; channels: string[] };
  skeleton?: SkeletonT;
  designs: Record<string, KeyDesignT>;
  decoys: Record<string, DecoyT[]>;
  codes?: CodeCheck[];
  map: Record<string, MapCheck>;
  chapters: Record<string, { text: string; leaks: string[] }>;
  production?: ProductionT;
  without?: Attack[];
  withLive?: Attack[];
  spent: Record<string, { input: number; output: number }>;
  done: boolean;
  log: string[];
  error?: string;
};

export function newWork(keys: number, writer: string = WRITERS.sonnet, wish?: { genre?: string; theme?: string }): Work {
  return { keys, writer, wish, designs: {}, decoys: {}, map: {}, chapters: {}, spent: {}, done: false, log: [] };
}

// ---- Claude -------------------------------------------------------------------------------------------------------
async function ask<T>(work: Work, model: string, user: string, schema: z.ZodType<T>, effort: "low" | "medium" | "high", label: string, system = BIBLE): Promise<T> {
  const claude = new Anthropic();
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
      work.log.push(`${label}: the answer was cut off, trying again`);
      continue;
    }
    const s = (work.spent[model] ??= { input: 0, output: 0 });
    s.input += response.usage.input_tokens;
    s.output += response.usage.output_tokens;
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens" && response.parsed_output) return response.parsed_output;
    work.log.push(`${label}: ${response.stop_reason}, trying again`);
  }
  throw new Error(`${label}: no usable answer from ${model}`);
}

// ---- The map ------------------------------------------------------------------------------------------------------
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * The map search the game uses. "Not found" only when it answers with nothing; when it's busy (it throttles a long run
 * of lookups) or the connection drops, it waits and asks again, up to four times.
 */
/** Answers already found (the importer saves them between runs: a rerun asks the map search nothing twice). */
export const mapCache = new Map<string, Spot | null>();
/**
 * Who asks the map search: Photon straight from here, or (the importer, owner 31 Oct 2026) through the live site, the
 * same server the players' searches go through, so a computer Photon has stopped answering can still check a story.
 */
export const mapSearch = { ask: photonAsk };
async function photon(q: string): Promise<Spot | null> {
  if (mapCache.has(q)) return mapCache.get(q)!;
  const spot = await mapSearch.ask(q);
  if (spot !== undefined) mapCache.set(q, spot);
  return spot ?? null;
}
/** undefined: the map search never answered (not cached, so a later run asks again). */
export async function photonAsk(q: string): Promise<Spot | null | undefined> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await wait(attempt === 0 ? 1000 : 4000 * attempt); // the public map search's fair use: about one a second
    try {
      const res = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": "Loota story engine" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue; // busy or throttled: try again
      const f = ((await res.json()) as { features: { properties: { name?: string; city?: string; country?: string }; geometry: { coordinates: [number, number] } }[] }).features[0];
      if (!f) return null;
      return { name: [f.properties.name, f.properties.city, f.properties.country].filter(Boolean).join(", "), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    } catch {
      // The connection dropped: try again.
    }
  }
  return undefined;
}
export function metres(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.round(Math.hypot(x, y) * 6371000);
}

// ---- Helpers ------------------------------------------------------------------------------------------------------
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
/** The `count` items used longest ago (never-used first), going round again when there are more keys than kinds. */
function leastRecent<T extends { id: string }>(items: T[], used: Used[], of: (u: Used) => string[], count: number): T[] {
  const last = new Map<string, number>();
  used.forEach((u, i) => of(u).forEach((id) => last.set(id, i)));
  const order = [...items].map((it) => ({ it, at: last.get(it.id) ?? -1, r: Math.random() })).sort((a, b) => a.at - b.at || a.r - b.r).map((x) => x.it);
  return Array.from({ length: count }, (_, i) => order[i % order.length]);
}
const letters = (s: string) => s.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();
const shiftBack = (s: string, n: number) => s.replace(/[A-Za-z]/g, (c) => String.fromCharCode(((c.toUpperCase().charCodeAt(0) - 65 - n) % 26 + 26) % 26 + 65));
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The plan with every key's design merged in. */
export function blueprintOf(work: Work) {
  const s = work.skeleton!;
  return { ...s, keys: s.keys.map((k) => ({ ...k, ...work.designs[k.n] })) };
}
export type Blueprint = ReturnType<typeof blueprintOf>;
/** Chapters between the prologue and the epilogue: room for every key's plants (about one more than the keys, 6 at least). */
const chaptersFor = (keys: number) => Math.max(6, keys + 1);

/** How far along: steps done of steps to do. */
export function progress(work: Work) {
  const k = work.keys;
  const chapters = work.skeleton?.chapters.length ?? chaptersFor(k) + 2;
  const total = 2 + k + k + 1 + k + chapters + 3;
  const done =
    (work.picked ? 1 : 0) + (work.skeleton ? 1 : 0) + Object.keys(work.designs).length + Object.keys(work.decoys).length + (work.codes ? 1 : 0) +
    Object.keys(work.map).length + Object.keys(work.chapters).length + (work.production ? 1 : 0) + (work.without ? 1 : 0) + (work.withLive ? 1 : 0);
  return { done, total };
}

/** The checks, for the report and the admin. */
export function verdict(work: Work) {
  return {
    codes: (work.codes ?? []).every((c) => c.ok),
    answersOnMap: Object.values(work.map).every((m) => !!m.found),
    noLeaks: Object.values(work.chapters).every((c) => c.leaks.length === 0),
    // The AI attack needs the paid API: null when it wasn't run (a story written in Claude Code and imported).
    aiFailsWithout: work.without ? work.without.every((a) => !a.solved) : null,
    aiSolvesWith: work.withLive ? work.withLive.every((a) => a.solved) : null,
  };
}

export function costOf(work: Work) {
  return Object.entries(work.spent).map(([m, s]) => {
    const p = PRICE[m];
    return `${m}: ${s.input.toLocaleString()} tokens in, ${s.output.toLocaleString()} out${p ? `, about $${((s.input * p[0] + s.output * p[1]) / 1e6).toFixed(2)}` : ""}`;
  });
}

/** What this story used, for the registry. */
export function usedBy(work: Work): Used {
  const b = blueprintOf(work);
  return {
    title: b.title, genre: work.picked?.genre ?? null, theme: work.picked?.theme ?? null,
    locks: work.picked?.locks ?? [], channels: work.picked?.channels ?? [],
    places: b.keys.map((k) => ({ name: k.answer.name, lng: work.map[k.n]?.found?.lng ?? 0, lat: work.map[k.n]?.found?.lat ?? 0 })),
    decoys: Object.values(work.decoys).flat().map((d) => d.place),
    characters: [...b.heroes.map((h) => h.name), b.villain.name],
  };
}

/** The assignment: which lock and channel each key uses. */
export function assignmentOf(work: Work) {
  return (work.picked?.locks ?? []).map((id, i) => ({ n: i + 1, lock: LOCKS.find((l) => l.id === id)!, channel: CHANNELS.find((c) => c.id === work.picked!.channels[i])! }));
}

// ---- The free checks (no Claude): also used to import a story written by hand or in Claude Code ----------------------

/** Every key's code (acrostic, letter shift, anagram) worked out by computer. */
export function checkCodes(work: Work): CodeCheck[] {
  return blueprintOf(work).keys.map((k) => {
    const c = k.check;
    if (c?.kind === "acrostic") {
      const got = c.lines.map((l) => letters(l)[0] ?? "").join("");
      return { n: k.n, kind: c.kind, ok: got === letters(c.plain), detail: `first letters spell ${got}, should spell ${letters(c.plain)}` };
    }
    if (c?.kind === "caesar") {
      const got = shiftBack(c.cipher, c.shift);
      return { n: k.n, kind: c.kind, ok: letters(got) === letters(c.plain), detail: `${c.cipher} shifted ${c.shift} back gives ${got}, should give ${c.plain}` };
    }
    if (c?.kind === "anagram") {
      const sort = (s: string) => [...letters(s)].sort().join("");
      return { n: k.n, kind: c.kind, ok: sort(c.cipher) === sort(c.plain), detail: `${c.cipher} vs ${c.plain}` };
    }
    return { n: k.n, kind: c?.kind ?? "none", ok: true, detail: "nothing to compute" };
  });
}

/** One key on the map: its answer, its aliases (each within 1.5 km of it) and its decoys (found, and 1 km away or more). */
export async function checkMapKey(work: Work, n: number): Promise<MapCheck> {
  const key = blueprintOf(work).keys.find((k) => k.n === n)!;
  const found = (await photon(key.answer.searchName)) ?? (await photon(`${key.answer.name}, ${key.answer.city}`));
  const aliases = [];
  for (const alias of key.answer.aliases) {
    const got = await photon(alias);
    aliases.push({ alias, ok: !!(found && got && metres(found, got) <= FOUND_M), got: got?.name ?? "nothing" });
  }
  const decoys = [];
  for (const d of work.decoys[n] ?? []) {
    const got = await photon(d.searchName);
    const gap = found && got ? metres(found, got) : null;
    decoys.push({ place: d.place, ok: !!got && (gap === null || gap >= DECOY_GAP_M), why: !got ? "not found on the map" : gap !== null && gap < DECOY_GAP_M ? `only ${gap} m from the answer` : "ok" });
  }
  const m = { answer: key.answer.name, found, aliases, decoys };
  work.map[n] = m;
  return m;
}

/** The names a chapter must never write: every key's answer and its aliases. */
export function secretNames(work: Work) {
  return blueprintOf(work).keys.flatMap((k) => [k.answer.name, ...k.answer.aliases]).filter((s) => s.length > 3);
}

/** Which key names each chapter lets slip (it should be none). */
export function chapterLeaks(work: Work) {
  const secret = secretNames(work);
  return Object.fromEntries(Object.entries(work.chapters).map(([n, c]) => [n, secret.filter((s) => fold(c.text).includes(fold(s)))]));
}

/**
 * Do the next step of the story (one Claude call, or one key's map check). Changes `work` and returns what it did.
 * `used`: every earlier story (never reuse their places, decoys, characters, titles; locks and channels least used first).
 */
export async function nextStep(work: Work, used: Used[], start?: string): Promise<string> {
  const wish = work.wish;
  // 1. The picks
  if (!work.picked) {
    const recent = used.slice(-3).map((u) => u.genre);
    const themes = new Set(used.map((u) => u.theme));
    work.picked = {
      genre: wish?.genre || (pick(GENRES.filter((g) => !recent.includes(g))) ?? pick(GENRES)),
      theme: wish?.theme || (pick(THEMES.filter((t) => !themes.has(t))) ?? pick(THEMES)),
      locks: leastRecent(LOCKS, used, (u) => u.locks, work.keys).map((l) => l.id),
      channels: leastRecent(CHANNELS, used, (u) => u.channels, work.keys).map((c) => c.id),
    };
    return `Picked a ${work.picked.genre}: "${work.picked.theme}"`;
  }
  const assignment = assignmentOf(work);
  const avoid = {
    places: used.flatMap((u) => u.places.map((p) => p.name)),
    decoys: used.flatMap((u) => u.decoys).slice(-400),
    characters: used.flatMap((u) => u.characters),
    titles: used.map((u) => u.title),
  };

  // 2. The plan
  if (!work.skeleton) {
    const brief = `Design a new Loota story hunt.

Genre: ${work.picked.genre}
Theme: ${work.picked.theme}
Number of keys: ${work.keys}
${start ? `Where the story begins: ${start}\n` : ""}
The keys, in order, with the lock (the kind of puzzle) and the channel (how the live piece reaches players) each must use:
${assignment.map((a) => `- Key ${a.n}: lock "${a.lock.id}" (${a.lock.name}: ${a.lock.how}); channel "${a.channel.id}" (${a.channel.name}: ${a.channel.how})`).join("\n")}

Already used (never reuse any of these):
- Places: ${avoid.places.join("; ") || "none yet"}
- Decoys: ${avoid.decoys.join("; ") || "none yet"}
- Characters: ${avoid.characters.join("; ") || "none yet"}
- Titles: ${avoid.titles.join("; ") || "none yet"}

Plan the story's skeleton now: title, characters, world rules, prologue, ${chaptersFor(work.keys)} chapters and an epilogue (number the prologue 0) with their beats and plants, and every key's question, answer and conditions. Keep beats and plants short: one line each. Spread the keys around the world. Make every answer a precise real place (a street, building, bridge, square, market) that exists on OpenStreetMap. Each key's detailed design, and the decoys, come in the next steps.`;
    work.skeleton = await ask(work, work.writer, brief, Skeleton, "medium", "plan");
    return `Planned "${work.skeleton.title}": ${work.skeleton.chapters.length} chapters, ${work.skeleton.keys.length} keys`;
  }
  const keys = work.skeleton.keys;

  // 3. Each key's design
  for (const key of keys) {
    if (work.designs[key.n]) continue;
    const a = assignment.find((x) => x.n === key.n) ?? assignment[0];
    work.designs[key.n] = await ask(work, work.writer, `The story's plan:\n${JSON.stringify(work.skeleton)}\n\nDesign key ${key.n} in full ("${key.question}", answer: ${key.answer.name}). Its lock: ${a.lock.name} (${a.lock.how}). Its channel: ${a.channel.name} (${a.channel.how}). Give the solving steps, the plants (chapter and detail), the live piece written out in full, and, if the lock has a mechanical part (acrostic, letter shift, anagram), the exact check data. The story alone must not solve it; story plus live piece must.`, KeyDesign, "medium", `key ${key.n}`);
    return `Designed key ${key.n}: ${key.answer.name}`;
  }
  const blueprint = blueprintOf(work);

  // 4. Decoys
  for (const key of blueprint.keys) {
    if (work.decoys[key.n]) continue;
    const r = await ask(work, work.writer, `The story so far (plan):\n${JSON.stringify(blueprint)}\n\nWrite at least 22 decoys for key ${key.n} ("${key.question}", true answer: ${key.answer.name}). Real places only, each at least 1 km from the true answer, each failing at least one of the key's conditions: ${key.conditions.join("; ")}. Mix types A, B and C. Spread them over several chapters, woven in naturally, never as a list. Never reuse: ${avoid.decoys.join("; ") || "none"}.`, Decoys, "medium", `decoys ${key.n}`);
    work.decoys[key.n] = r.decoys;
    return `${r.decoys.length} decoys for key ${key.n}`;
  }

  // 5. Codes, worked out by computer
  if (!work.codes) {
    work.codes = checkCodes(work);
    return `Codes checked: ${work.codes.filter((c) => c.ok).length}/${work.codes.length} right`;
  }

  // 6. The map, key by key
  for (const key of blueprint.keys) {
    if (work.map[key.n]) continue;
    const m = await checkMapKey(work, key.n);
    return `Map, key ${key.n}: answer ${m.found ? "found" : "NOT FOUND"}, ${m.decoys.filter((d) => d.ok).length}/${m.decoys.length} decoys on the map`;
  }

  // 7. The chapters
  const secret = secretNames(work);
  const leaks = (text: string) => secret.filter((s) => fold(text).includes(fold(s)));
  const decoyNotes = Object.entries(work.decoys).map(([n, list]) => `Key ${n} decoys: ${list.map((d) => `[ch ${d.chapter}] ${d.place}: ${d.how}`).join(" | ")}`).join("\n");
  for (const ch of blueprint.chapters) {
    if (work.chapters[ch.n]) continue;
    const prev = [...blueprint.chapters].filter((c) => c.n < ch.n).at(-1);
    const before = prev ? (work.chapters[prev.n]?.text.slice(-1500) ?? "") : "(this is the beginning)";
    const brief = `The plan:\n${JSON.stringify(blueprint)}\n\nDecoys to weave in:\n${decoyNotes}\n\nWrite chapter ${ch.n}, "${ch.title}" (${ch.setting}). Its beats: ${ch.beats.join("; ")}. Its plants: ${ch.plants.join("; ")}. Weave in every decoy assigned to chapter ${ch.n}, naturally. 900 to 1,400 words.\n\nThe previous chapter ended:\n${before}\n\nNever write any of these names: ${secret.join("; ")}. Never write a key's live piece content (it reaches players only in the game).`;
    let { text } = await ask(work, work.writer, brief, Chapter, "medium", `chapter ${ch.n}`);
    let found = leaks(text);
    if (found.length) {
      ({ text } = await ask(work, work.writer, `${brief}\n\nYour last version named ${found.join(", ")}. Rewrite it without them:\n${text}`, Chapter, "medium", `chapter ${ch.n} again`));
      found = leaks(text);
    }
    work.chapters[ch.n] = { text, leaks: found };
    return `Wrote chapter ${ch.n}: ${ch.title}${found.length ? ` (still names ${found.join(", ")})` : ""}`;
  }

  // 8. Pictures and voices
  if (!work.production) {
    work.production = await ask(work, work.writer, `The plan:\n${JSON.stringify(blueprint)}\n\nWrite the production pack: 3 picture prompts per chapter for ChatGPT (16:9, cinematic painted thriller style, consistent characters; each prompt complete on its own, with the style and each character's fixed look written into it), a fixed look for each character, and a voice direction for the narrator, each speaking character and each live piece's voice.`, Production, "medium", "pictures");
    return `${work.production.pictures.length} picture prompts and ${work.production.voices.length} voices`;
  }

  // 9. The AI attack: without the live pieces it should fail; with them, succeed (it's fair)
  const storyText = blueprint.chapters.map((c) => `${c.title}\n${c.setting}\n\n${work.chapters[c.n]?.text ?? ""}`).join("\n\n");
  const attack = async (withLive: boolean): Promise<Attack[]> => {
    const brief = `This is a treasure-hunt story. Find the exact real-world place (street or building, city, country) for each question.\n\n${blueprint.keys.map((k) => `Key ${k.n}: ${k.question}`).join("\n")}\n\n${withLive ? `Extra evidence the game gave players:\n${blueprint.keys.map((k) => `Key ${k.n}: ${k.livePiece.content}`).join("\n")}\n\n` : ""}The story:\n\n${storyText}`;
    const r = await ask(work, SOLVER, brief, Solved, "high", withLive ? "attack with live pieces" : "attack without", "You are an expert puzzle solver and geographer.");
    const out: Attack[] = [];
    for (const key of blueprint.keys) {
      const guess = r.keys.find((g) => g.n === key.n);
      const spot = guess ? await photon(`${guess.place}, ${guess.city}, ${guess.country}`) : null;
      const truth = work.map[key.n]?.found;
      const gap = spot && truth ? metres(spot, truth) : null;
      out.push({ n: key.n, guess: guess ? `${guess.place}, ${guess.city}` : "no answer", solved: gap !== null && gap <= FOUND_M, gap });
    }
    return out;
  };
  if (!work.without) {
    work.without = await attack(false);
    return `AI attack without the live pieces: solved ${work.without.filter((a) => a.solved).length} of ${work.without.length} (should be 0)`;
  }
  if (!work.withLive) {
    work.withLive = await attack(true);
    return `AI attack with the live pieces: solved ${work.withLive.filter((a) => a.solved).length} of ${work.withLive.length} (should be all)`;
  }
  work.done = true;
  return "Done";
}
