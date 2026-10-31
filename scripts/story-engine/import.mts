// Bring a story written in Claude Code into its hunt (owner, 31 Oct 2026: no paid API). Checks it first, free:
//   - its shape (the same as the engine's: STORY_SHAPES in src/lib/story/engine.ts) and that every chapter is written;
//   - every code (acrostic, letter shift, anagram) worked out by computer;
//   - every answer, alias and decoy on the map (the game's map search), no decoy within 1 km of its answer;
//   - no chapter names a key place; 6 decoys or more per key, each a false trail in the plot (owner, 31 Oct 2026).
// Then: the PDFs and files in docs/stories/<date>-<slug>/, and the hunt gets its title, description, keys at the real
// places, and a picture slot per prompt (shown in the admin with Copy prompt and Upload picture).
//   npm run story:import -- <draft.json> --hunt <id> [--chapters <folder of 0.md, 1.md…>]
//   npm run story:import -- <draft.json> --day 2026-11-02 [--days 1] --prize "₦50,000 voucher" [--winners 3]
//   --check: only check, change nothing. --force: import even if a check fails. --map-here: ask the map search from this
//   computer instead of through the live site.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { blueprintOf, chapterLeaks, checkCodes, checkMapKey, mapCache, mapSearch, STORY_SHAPES, type Spot, type Work } from "../../src/lib/story/engine.ts";
import { mapPass } from "../../src/lib/story/map-pass.ts";
import { finishStoryHunt } from "../../src/lib/story/finish.ts";
import { renderStory } from "./render.mts";

process.loadEnvFile(".env.local");
const argv = process.argv;
const opt = (name: string, fallback: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const file = argv.slice(2).find((a) => a.endsWith(".json"));
if (!file) throw new Error("Which story? npm run story:import -- <draft.json> --hunt <id>");
const work = JSON.parse(readFileSync(file, "utf8")) as Work;
// Chapters may be written as text files (<folder>/0.md, 1.md…: easier to write than JSON); they replace the draft's.
const chapterDir = opt("chapters", "");
if (chapterDir && work.skeleton) {
  work.chapters ??= {};
  for (const c of work.skeleton.chapters) {
    const path = `${chapterDir}/${c.n}.md`;
    if (existsSync(path)) work.chapters[c.n] = { text: readFileSync(path, "utf8").trim(), leaks: [] };
  }
}
const problems: string[] = [];
const warnings: string[] = [];

// ---- Its shape
const shape = (what: string, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown) => {
  const r = schema.safeParse(value);
  if (!r.success) problems.push(`${what}: ${r.error!.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
};
shape("the plan (skeleton)", STORY_SHAPES.Skeleton, work.skeleton);
if (!work.skeleton) throw new Error(`No plan in ${file}:\n${problems.join("\n")}`);
for (const k of work.skeleton.keys) {
  shape(`key ${k.n}'s design`, STORY_SHAPES.KeyDesign, work.designs?.[k.n]);
  shape(`key ${k.n}'s decoys`, STORY_SHAPES.Decoys, { decoys: work.decoys?.[k.n] });
  if ((work.decoys?.[k.n]?.length ?? 0) < 6) problems.push(`key ${k.n} has ${work.decoys?.[k.n]?.length ?? 0} decoys (6 or more)`);
}
for (const c of work.skeleton.chapters) {
  const words = work.chapters?.[c.n]?.text?.split(/\s+/).filter(Boolean).length ?? 0;
  if (!words) problems.push(`chapter ${c.n} ("${c.title}") isn't written`);
  else if (words < 250) warnings.push(`chapter ${c.n} is short (${words} words)`);
  else if (words > 1100) warnings.push(`chapter ${c.n} is long (${words} words): keep chapters quick to read on a phone`);
}
shape("the pictures and voices (production)", STORY_SHAPES.Production, work.production);
if ((work.production?.pictures.length ?? 0) > 3) warnings.push(`${work.production!.pictures.length} picture prompts: the trailer needs 3 (ChatGPT makes 3 a day)`);
if (work.production && !work.production.trailer) warnings.push("no trailer voice-over script (production.trailer)");
if (work.skeleton.keys.length !== work.keys) warnings.push(`the plan has ${work.skeleton.keys.length} keys, the draft asked for ${work.keys}`);
if (problems.length) {
  console.log(`Not ready to import:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`);
  process.exit(1);
}
work.map ??= {};
work.spent ??= {};
work.log ??= [];

// ---- Codes, leaks, the map
work.codes = checkCodes(work);
for (const c of work.codes) (c.ok ? console.log : (m: string) => problems.push(m))(`code, key ${c.n} (${c.kind}): ${c.ok ? "ok" : "WRONG"}: ${c.detail}`);
const leaks = chapterLeaks(work);
for (const [n, names] of Object.entries(leaks)) {
  work.chapters[n].leaks = names;
  if (names.length) problems.push(`chapter ${n} names ${names.join(", ")}`);
}
// Quick problems first: no point checking ~100 places on the map while a code is wrong or a chapter gives a place away.
if (problems.length && !argv.includes("--force")) {
  console.log(`\nFix these first:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`);
  process.exit(1);
}
const b = blueprintOf(work);
// The map search through the live site (owner, 31 Oct 2026): the server the players' searches go through, so it's their
// map search, and Photon stopping this computer doesn't stop the check. --map-here asks Photon from this computer.
if (!argv.includes("--map-here")) {
  const site = process.env.STORY_CHECK_SITE ?? "https://loota-plum.vercel.app";
  const pass = mapPass(process.env.SUPABASE_SECRET_KEY!);
  mapSearch.ask = async (q) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${site}/api/admin/map-check?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${pass}` }, signal: AbortSignal.timeout(70_000) });
        if (res.status === 401 || res.status === 404) throw new Error(`The live site's map check isn't there (${res.status}): has the latest version deployed? (Or use --map-here.)`);
        if (res.ok) return ((await res.json()) as { spot: Spot | null }).spot;
      } catch (e) {
        if (e instanceof Error && /live site/.test(e.message)) throw e;
      }
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
    return undefined; // never answered: not cached, a rerun asks again
  };
}
// What the map search has already answered, kept between runs (a fix-and-rerun asks it nothing twice).
const CACHE = "docs/stories/.map-cache.json";
if (existsSync(CACHE)) for (const [q, spot] of Object.entries(JSON.parse(readFileSync(CACHE, "utf8")))) mapCache.set(q, spot as Spot | null);
for (const key of b.keys) {
  process.stdout.write(`map, key ${key.n} (${key.answer.name})… `);
  const m = await checkMapKey(work, key.n);
  console.log(`${m.found ? `found: ${m.found.name}` : "NOT FOUND"}; aliases ${m.aliases.filter((a) => a.ok).length}/${m.aliases.length}; decoys ${m.decoys.filter((d) => d.ok).length}/${m.decoys.length}`);
  if (!m.found) problems.push(`key ${key.n}: "${key.answer.searchName}" isn't found on the map (change searchName; or, if every lookup fails, the map search is busy: try again later)`);
  for (const a of m.aliases.filter((x) => !x.ok)) warnings.push(`key ${key.n}: alias "${a.alias}" finds ${a.got} (add it to the game's own places, or drop it)`);
  for (const d of m.decoys.filter((x) => !x.ok)) (/only \d+ m/.test(d.why) ? problems : warnings).push(`key ${key.n}: decoy "${d.place}" ${d.why}`);
}
writeFileSync(file, JSON.stringify(work, null, 2)); // keep the checks with the draft
writeFileSync(CACHE, JSON.stringify(Object.fromEntries(mapCache)));
if (warnings.length) console.log(`\nWorth a look:\n${warnings.map((w) => `  ! ${w}`).join("\n")}`);
if (problems.length) {
  console.log(`\nFix these first:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`);
  if (!argv.includes("--force")) process.exit(1);
}
if (argv.includes("--check")) {
  console.log("\nChecks done (nothing imported: --check).");
  process.exit(0);
}

// ---- The hunt
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let hunt = opt("hunt", "");
if (hunt) {
  const { data: h } = await db.from("hunts").select("id, published").eq("id", hunt).maybeSingle();
  if (!h) throw new Error(`No hunt ${hunt}`);
  if (h.published) throw new Error("That hunt is published: unpublish it before giving it a new story.");
} else {
  const day = opt("day", "");
  const days = Number(opt("days", "1"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Give --hunt <id>, or --day YYYY-MM-DD (and --prize) to make a new hunt.");
  const startsAt = new Date(`${day}T09:00:00+01:00`);
  const { data: h, error } = await db.from("hunts").insert({
    title: b.title.slice(0, 80), prize: opt("prize", "To be announced"), description: "", winners: Number(opt("winners", "3")),
    questions_per_trial: 3, seconds_per_question: 12, starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + (days - 1) * 86_400_000 + 12 * 3_600_000).toISOString(), keys_wanted: work.keys, story_status: "waiting",
  }).select("id").single();
  if (error) throw error;
  hunt = h.id;
}
work.done = true;
const out = await renderStory(work, new Date().toISOString().slice(0, 10));
const notes = await finishStoryHunt(hunt, work);
console.log(`\n"${b.title}" is now hunt ${hunt}: ${b.keys.length} keys, ${work.production?.pictures.length ?? 0} picture prompts.`);
for (const n of notes) console.log(`  ! ${n}`);
console.log(`PDFs: ${out}/story.pdf and ${out}/answers.pdf\nAdmin: /admin (the hunt's card: Read the story, and the pictures to upload)`);
