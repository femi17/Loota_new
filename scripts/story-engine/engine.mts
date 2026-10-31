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
import { pathToFileURL } from "node:url";
import { BIBLE } from "../../src/lib/story/bible.ts";
import { assignmentOf, blueprintOf, costOf, newWork, nextStep, progress, usedBy, verdict, WRITERS, type Used, type Work } from "../../src/lib/story/engine.ts";

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
const b = blueprintOf(work);
const slug = b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
const out = `${DIR}/${DATE}-${slug}`;
mkdirSync(out, { recursive: true });
const v = verdict(work);
const cost = costOf(work);
writeFileSync(`${out}/story.json`, JSON.stringify(work, null, 2));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (t: string) => t.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("\n");
const style = readFileSync("scripts/story-engine/style.css", "utf8");
const storyHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(b.title)}</title><style>${style}</style></head><body class="story">
<div class="cover"><h1>${esc(b.title)}</h1><div class="sub">A Loota treasure hunt in ${work.keys} keys</div><p class="how">${esc(b.logline)}<br><br>Everything you need is in this story, and in the game. ${work.keys} places are hidden in it, somewhere in the world.</p></div>
${b.chapters.map((c) => `<section><h2>${esc(c.title)}</h2><p class="where">${esc(c.setting)}</p>${paras(work.chapters[c.n]?.text ?? "")}</section>`).join("\n")}
<p class="end">THE END</p></body></html>`;
const tick = (ok: boolean) => (ok ? '<b class="ok">✓</b>' : '<b class="bad">✗</b>');
const assignment = assignmentOf(work);
const answersHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(b.title)}: answers</title><style>${style}</style></head><body class="answers">
<div class="secret">ANSWERS · DO NOT SHARE WITH PLAYERS</div>
<h1>${esc(b.title)}</h1>
<p>${esc(work.picked!.genre)} · ${esc(work.picked!.theme)} · ${DATE} · written by ${work.writer}</p>
<div class="verdict">
<p>${tick(v.codes)} Codes decode exactly</p>
<p>${tick(v.answersOnMap)} Every answer is on the map</p>
<p>${tick(v.noLeaks)} No key place named in the story</p>
<p>${tick(v.aiFailsWithout)} An AI with the story alone can't find the places</p>
<p>${tick(v.aiSolvesWith)} An AI with the story and the live pieces can (it's fair)</p>
</div>
<h3>World rules players can learn</h3><ul>${b.worldRules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
${b.keys.map((k) => {
  const a = assignment.find((x) => x.n === k.n)!;
  const m = work.map[k.n];
  const w = work.without?.find((x) => x.n === k.n);
  const l = work.withLive?.find((x) => x.n === k.n);
  const ds = work.decoys[k.n] ?? [];
  return `<div class="key"><h2>🗝️ ${k.n}. ${esc(k.question)}</h2>
<p class="ans">${esc(k.answer.name)} · ${esc(k.answer.city)}, ${esc(k.answer.country)}</p>
<p><b>Lock:</b> ${esc(a.lock.name)} · <b>Live piece:</b> ${esc(a.channel.name)}${a.channel.game === "to-build" ? " <i>(game feature to build)</i>" : ""}</p>
<p><b>Conditions only the answer meets:</b></p><ul>${k.conditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
<p><b>How it's solved:</b></p><ol>${k.solveSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<p><b>Planted:</b> ${k.plants.map((p) => `ch ${p.chapter}: ${esc(p.detail)}`).join(" · ")}</p>
<div class="live"><b>The live piece</b> (${esc(k.livePiece.where)}; ${esc(k.livePiece.when)}${k.livePiece.perPlayer ? "; different for every player" : ""}):<br>${esc(k.livePiece.content)}</div>
<p><b>Checks:</b> map ${m?.found ? `found (${esc(m.found.name)})` : "NOT FOUND"} · aliases ${m?.aliases.filter((x) => x.ok).length ?? 0}/${m?.aliases.length ?? 0} · AI without live piece: ${w?.solved ? '<b class="bad">solved it</b>' : "failed"} (${esc(w?.guess ?? "")}) · with it: ${l?.solved ? "solved" : '<b class="bad">failed</b>'}</p>
<p><b>${ds.length} decoys:</b></p><table><tr><th>Place</th><th>Type</th><th>Why tempting</th><th>Fails</th><th>Map</th></tr>${ds.map((d) => {
    const c = m?.decoys.find((x) => x.place === d.place);
    return `<tr><td>${esc(d.place)} <span class="small">(ch ${d.chapter})</span></td><td>${d.type}</td><td>${esc(d.tempting)}</td><td>${esc(d.fails)}</td><td>${c?.ok ? "✓" : `<b class="bad">${esc(c?.why ?? "?")}</b>`}</td></tr>`;
  }).join("")}</table></div>`;
}).join("\n")}
<h3>Pictures (ChatGPT)</h3><p><b>Style:</b> ${esc(work.production!.style)}</p>
<ul>${work.production!.characters.map((c) => `<li><b>${esc(c.name)}:</b> ${esc(c.look)}</li>`).join("")}</ul>
<ol>${work.production!.pictures.map((p) => `<li><span class="small">ch ${p.chapter}</span> ${esc(p.prompt)}</li>`).join("")}</ol>
<h3>Voices (ElevenLabs)</h3><ul>${work.production!.voices.map((x) => `<li><b>${esc(x.name)}:</b> ${esc(x.direction)}</li>`).join("")}</ul>
<p class="small">Cost: ${cost.map(esc).join("; ")}</p>
</body></html>`;
writeFileSync(`${out}/story.html`, storyHtml);
writeFileSync(`${out}/answers.html`, answersHtml);

const puppeteer = app("puppeteer-core");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
for (const name of ["story", "answers"]) {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(`${out}/${name}.html`).href, { waitUntil: "networkidle0" });
  await page.pdf({ path: `${out}/${name}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true });
}
await browser.close();
writeFileSync(`${out}/report.md`, `# ${b.title}\n\n${work.picked!.genre} · ${work.picked!.theme} · ${DATE}\n\n${Object.entries(v).map(([k, ok]) => `- ${ok ? "PASS" : "FAIL"} ${k}`).join("\n")}\n\n${cost.map((c) => `- ${c}`).join("\n")}\n`);

const { error } = await db.from("story_registry").insert(usedBy(work));
if (error) console.log(`Couldn't record it in the registry: ${error.message}`);

console.log(`\nWritten to ${out}/ (story.pdf, answers.pdf, story.json, report.md)`);
for (const [k, ok] of Object.entries(v)) console.log(`  ${ok ? "PASS" : "FAIL"} ${k}`);
for (const c of cost) console.log(`  ${c}`);
