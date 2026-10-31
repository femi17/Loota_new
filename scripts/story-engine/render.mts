// A finished story as two PDFs (story.pdf for players, answers.pdf for the owner), plus story.json, story.html,
// answers.html and report.md, in docs/stories/<date>-<slug>/. Used by engine.mts (paid API) and import.mts (a story
// written in Claude Code).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { assignmentOf, blueprintOf, costOf, verdict, type Work } from "../../src/lib/story/engine.ts";

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (t: string) => t.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("\n");
const mark = (ok: boolean | null) => (ok === null ? '<b class="small">– not run</b>' : ok ? '<b class="ok">✓</b>' : '<b class="bad">✗</b>');

/** Writes the story's files; returns the folder. */
export async function renderStory(work: Work, date: string): Promise<string> {
  const b = blueprintOf(work);
  const slug = b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  const out = `docs/stories/${date}-${slug}`;
  mkdirSync(out, { recursive: true });
  const v = verdict(work);
  const cost = costOf(work);
  writeFileSync(`${out}/story.json`, JSON.stringify(work, null, 2));
  const style = readFileSync("scripts/story-engine/style.css", "utf8");
  const storyHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(b.title)}</title><style>${style}</style></head><body class="story">
<div class="cover"><h1>${esc(b.title)}</h1><div class="sub">A Loota treasure hunt in ${work.keys} keys</div><p class="how">${esc(b.logline)}<br><br>Everything you need is in this story, and in the game. ${work.keys} places are hidden in it, somewhere in the world.</p></div>
${b.chapters.map((c) => `<section><h2>${esc(c.title)}</h2><p class="where">${esc(c.setting)}</p>${paras(work.chapters[c.n]?.text ?? "")}</section>`).join("\n")}
<p class="end">THE END</p></body></html>`;
  const assignment = assignmentOf(work);
  const answersHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(b.title)}: answers</title><style>${style}</style></head><body class="answers">
<div class="secret">ANSWERS · DO NOT SHARE WITH PLAYERS</div>
<h1>${esc(b.title)}</h1>
<p>${esc(work.picked?.genre ?? "")} · ${esc(work.picked?.theme ?? "")} · ${date} · written by ${esc(work.writer)}</p>
<div class="verdict">
<p>${mark(v.codes)} Codes decode exactly</p>
<p>${mark(v.answersOnMap)} Every answer is on the map</p>
<p>${mark(v.noLeaks)} No key place named in the story</p>
<p>${mark(v.aiFailsWithout)} An AI with the story alone can't find the places</p>
<p>${mark(v.aiSolvesWith)} An AI with the story and the live pieces can (it's fair)</p>
</div>
<h3>World rules players can learn</h3><ul>${b.worldRules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
${b.keys.map((k) => {
  const a = assignment.find((x) => x.n === k.n);
  const m = work.map[k.n];
  const ds = work.decoys[k.n] ?? [];
  return `<div class="key"><h2>🗝️ ${k.n}. ${esc(k.question)}</h2>
<p class="ans">${esc(k.answer.name)} · ${esc(k.answer.city)}, ${esc(k.answer.country)}</p>
${a ? `<p><b>Lock:</b> ${esc(a.lock.name)} · <b>Live piece:</b> ${esc(a.channel.name)}${a.channel.game === "to-build" ? " <i>(game feature to build)</i>" : ""}</p>` : ""}
<p><b>Conditions only the answer meets:</b></p><ul>${k.conditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
<p><b>How it's solved:</b></p><ol>${k.solveSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<p><b>Planted:</b> ${k.plants.map((p) => `ch ${p.chapter}: ${esc(p.detail)}`).join(" · ")}</p>
<div class="live"><b>The live piece</b> (${esc(k.livePiece.where)}; ${esc(k.livePiece.when)}${k.livePiece.perPlayer ? "; different for every player" : ""}):<br>${esc(k.livePiece.content)}</div>
<p><b>Map:</b> ${m?.found ? `found (${esc(m.found.name)})` : "NOT FOUND"} · aliases ${m?.aliases.filter((x) => x.ok).length ?? 0}/${m?.aliases.length ?? 0}</p>
<p><b>${ds.length} decoys:</b></p><table><tr><th>Place</th><th>Type</th><th>Why tempting</th><th>Fails</th><th>Map</th></tr>${ds.map((d) => {
    const c = m?.decoys.find((x) => x.place === d.place);
    return `<tr><td>${esc(d.place)} <span class="small">(ch ${d.chapter})</span></td><td>${d.type}</td><td>${esc(d.tempting)}</td><td>${esc(d.fails)}</td><td>${c?.ok ? "✓" : `<b class="bad">${esc(c?.why ?? "?")}</b>`}</td></tr>`;
  }).join("")}</table></div>`;
}).join("\n")}
${work.production ? `<h3>Pictures (ChatGPT)</h3><p><b>Style:</b> ${esc(work.production.style)}</p>
<ul>${work.production.characters.map((c) => `<li><b>${esc(c.name)}:</b> ${esc(c.look)}</li>`).join("")}</ul>
<ol>${work.production.pictures.map((p) => `<li><span class="small">ch ${p.chapter}</span> ${esc(p.prompt)}</li>`).join("")}</ol>
<h3>Voices (ElevenLabs)</h3><ul>${work.production.voices.map((x) => `<li><b>${esc(x.name)}:</b> ${esc(x.direction)}</li>`).join("")}</ul>` : ""}
${cost.length ? `<p class="small">Cost: ${cost.map(esc).join("; ")}</p>` : ""}
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
  writeFileSync(`${out}/report.md`, `# ${b.title}\n\n${work.picked?.genre ?? ""} · ${work.picked?.theme ?? ""} · ${date}\n\n${Object.entries(v).map(([k, ok]) => `- ${ok === null ? "NOT RUN" : ok ? "PASS" : "FAIL"} ${k}`).join("\n")}\n\n${cost.map((c) => `- ${c}`).join("\n")}\n`);
  return out;
}
