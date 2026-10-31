// The story engine on the command line (the admin runs the same engine, src/lib/story/engine.ts, step by step).
// One run makes one complete story hunt and writes docs/stories/<date>-<slug>/: story.pdf (for players), answers.pdf
// (for you), story.json, report.md; and records what it used in the story registry (Supabase story_registry), so no
// later story, here or in the admin, repeats it. Work is saved after every step: run the same command again (same
// --date) to carry on after a failure; --fresh starts over.
//
//   npm run story:new -- [--keys 5] [--writer sonnet|opus] [--genre "spy thriller"] [--theme "..."]
//                         [--start "West Africa"] [--date 2026-10-31] [--dry] [--fresh] [--bible]
// --bible prints the writers' brief (to paste into any AI chat). Needs ANTHROPIC_API_KEY in .env.local.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { BIBLE } from "../../src/lib/story/bible.ts";
import { assignmentOf, costOf, newWork, nextStep, progress, usedBy, verdict, WRITERS, type Used, type Work } from "../../src/lib/story/engine.ts";
import { renderStory } from "./render.mts";

if (process.argv.includes("--bible")) {
  console.log(BIBLE);
  process.exit(0);
}
process.loadEnvFile(".env.local");
const argv = process.argv;
const opt = (name: string, fallback: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const KEYS = Number(opt("keys", "5"));
const WRITER = opt("writer", "sonnet") === "opus" ? WRITERS.opus : WRITERS.sonnet;
const DATE = opt("date", new Date().toISOString().slice(0, 10));
const DIR = "docs/stories";
const WORK = `${DIR}/.work-${DATE}.json`;

const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { data: rows, error: regError } = await db.from("story_registry").select("title, genre, theme, locks, channels, places, decoys, characters").order("id");
if (regError) throw regError;
const used = (rows ?? []) as Used[];

// The work so far (a work file from the first version of the engine is converted).
let work: Work = newWork(KEYS, WRITER, { genre: opt("genre", ""), theme: opt("theme", "") });
if (existsSync(WORK) && !argv.includes("--fresh")) {
  const saved = JSON.parse(readFileSync(WORK, "utf8"));
  if ("designs" in saved) work = saved;
  else {
    work.picked = saved.picked;
    work.skeleton = saved.skeleton;
    for (const [k, v] of Object.entries(saved)) {
      const m = k.match(/^(key|decoys)-(\d+)$/);
      if (m && m[1] === "key") work.designs[m[2]] = v as Work["designs"][string];
      if (m && m[1] === "decoys") work.decoys[m[2]] = (v as { decoys: Work["decoys"][string] }).decoys;
    }
    work.keys = saved.skeleton?.keys.length ?? KEYS;
  }
}
mkdirSync(DIR, { recursive: true });
const save = () => writeFileSync(WORK, JSON.stringify(work, null, 2));

if (argv.includes("--dry")) {
  const probe = newWork(KEYS, WRITER, work.wish);
  await nextStep(probe, used);
  console.log(`Story for ${DATE}: ${probe.picked!.genre}, "${probe.picked!.theme}", ${KEYS} keys, written by ${WRITER}`);
  for (const a of assignmentOf(probe)) console.log(`  key ${a.n}: lock ${a.lock.name} · live piece by ${a.channel.name}${a.channel.game === "to-build" ? " (game feature to build)" : ""}`);
  process.exit(0);
}

console.log(`Story for ${DATE}, ${work.keys} keys, written by ${work.writer}${work.skeleton ? ` (carrying on "${work.skeleton.title}")` : ""}`);
while (!work.done) {
  const logged = work.log.length;
  const did = await nextStep(work, used, argv.includes("--start") ? opt("start", "") : undefined);
  save();
  for (const line of work.log.slice(logged)) console.log(`  (${line})`);
  const p = progress(work);
  console.log(`[${p.done}/${p.total}] ${did}`);
}

// ---- Write it out --------------------------------------------------------------------------------------------------
const out = await renderStory(work, DATE);
const { error } = await db.from("story_registry").insert(usedBy(work));
if (error) console.log(`Couldn't record it in the registry: ${error.message}`);
console.log(`
Written to ${out}/ (story.pdf, answers.pdf, story.json, report.md)`);
for (const [k, ok] of Object.entries(verdict(work))) console.log(`  ${ok === null ? "NOT RUN" : ok ? "PASS" : "FAIL"} ${k}`);
for (const c of costOf(work)) console.log(`  ${c}`);
