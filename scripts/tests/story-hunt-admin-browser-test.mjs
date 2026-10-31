// Story hunts in the admin (owner, 31 Oct 2026: "enter the number of keys, the start time is from 9am to 9pm… a prompt
// for image generation… and where I will upload it to"):
//   1. "New story hunt" with 2 keys: a draft hunt, 9 am to 9 pm Lagos, being written; the progress panel starts.
//   2. Without API credit (or any error) it stops with the reason and Carry on, not a hang. (With credit it carries on.)
//   3. Finishing: a hunt holding a nearly finished story (the Keeper's Last Light plan, with stand-in text where Claude
//      would write) runs its map checks live, then becomes its hunt: the story's title, a key at each real place, and a
//      picture slot per prompt.
//   4. A picture uploaded in a slot goes to Storage and shows.
//   5. The story page shows the story and its answers.
// The test hunts, their pictures and registry rows, and the test owner are deleted.
//   SHOTS=<folder> node scripts/tests/story-hunt-admin-browser-test.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
const sharp = app("sharp");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? tmpdir();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let browser, id = null;
const huntIds = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

// A nearly finished story: the saved Keeper's Last Light plan, keys and decoys (3 per key, to keep the map check short),
// with stand-in chapters, pictures and attack results: only the map checks are left to do.
function nearlyFinished() {
  const saved = JSON.parse(readFileSync("docs/stories/.work-2026-10-30.json", "utf8"));
  const designs = {}, decoys = {};
  for (const [k, v] of Object.entries(saved)) {
    const m = k.match(/^(key|decoys)-(\d+)$/);
    if (m?.[1] === "key") designs[m[2]] = v;
    if (m?.[1] === "decoys") decoys[m[2]] = v.decoys.slice(0, 3);
  }
  const s = saved.skeleton;
  return {
    keys: s.keys.length, writer: "claude-sonnet-5-5", picked: saved.picked, skeleton: s, designs, decoys,
    codes: s.keys.map((k) => ({ n: k.n, kind: "none", ok: true, detail: "test" })),
    map: {},
    chapters: Object.fromEntries(s.chapters.map((c) => [c.n, { text: `Stand-in text for "${c.title}".\n\nA second paragraph.`, leaks: [] }])),
    production: { style: "test", characters: [], voices: [{ name: "Narrator", direction: "test" }], pictures: [{ chapter: 0, prompt: "A lighthouse in fog, test prompt one." }, { chapter: 1, prompt: "A harbour at dawn, test prompt two." }] },
    without: s.keys.map((k) => ({ n: k.n, guess: "test", solved: false, gap: null })),
    withLive: s.keys.map((k) => ({ n: k.n, guess: "test", solved: true, gap: 0 })),
    spent: {}, done: false, log: [],
  };
}

try {
  const email = `storyhunt-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ is_admin: true, home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000 });
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });

  // ---- 1. The form
  const fields = await page.evaluate(() => [...document.querySelectorAll("form")].find((f) => f.querySelector('input[name="keys"]'))?.querySelectorAll("input:not([type=hidden])").length ?? 0);
  check("New story hunt asks only for keys, day, days, prize and winners", fields === 5, `${fields} fields`);
  await page.evaluate(() => {
    const f = [...document.querySelectorAll("form")].find((x) => x.querySelector('input[name="keys"]'));
    f.querySelector('input[name="keys"]').value = "2";
    f.querySelector('input[name="prize"]').value = "Test prize (automated)";
  });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {}), page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Write the story/.test(b.textContent ?? ""))?.click())]);
  const { data: made } = await admin.from("hunts").select("id, title, starts_at, ends_at, story_status, keys_wanted, published").eq("created_by", id).order("created_at", { ascending: false }).limit(1).single();
  if (made) huntIds.push(made.id);
  const lagosHour = (iso) => (new Date(iso).getUTCHours() + 1) % 24;
  check("…a draft hunt being written, 2 keys, 9 am to 9 pm Lagos", made?.story_status && made.keys_wanted === 2 && !made.published && lagosHour(made.starts_at) === 9 && lagosHour(made.ends_at) === 21, made ? `${made.story_status}, ${made.starts_at} → ${made.ends_at}` : "none");

  // ---- 2. The progress panel runs, and stops cleanly when it can't go on
  let panel = "";
  // Until it stops (no credit, shown with Carry on) or writes its plan (credit): up to 3 minutes.
  for (let i = 0; i < 90 && !/Carry on/.test(panel); i++) {
    await wait(2000);
    panel = await page.evaluate(() => document.querySelector('[aria-label="Story progress"]')?.textContent ?? "");
    const { data: h } = await admin.from("hunts").select("story").eq("id", made.id).single();
    if (h.story?.skeleton) break;
  }
  const { data: after } = await admin.from("hunts").select("story_status, story").eq("id", made.id).single();
  check("…the progress panel started (the genre and theme were picked)", !!after.story?.picked, after.story?.picked ? `${after.story.picked.genre}, "${after.story.picked.theme}"` : "");
  if (after.story_status === "failed") {
    check("…without API credit it stops with the reason and Carry on (no hang)", /credit|stopped/i.test(panel) && /Carry on/.test(panel), panel.slice(0, 160));
  } else {
    check("…with API credit it keeps writing", after.story_status === "writing" || after.story_status === "ready", after.story_status);
  }
  await page.screenshot({ path: `${OUT}/story-hunt-1-progress.png` });

  // ---- 3. Finishing a nearly finished story
  const { data: near, error: nearErr } = await admin.from("hunts").insert({
    title: "A new story (being written…)", prize: "Test prize (automated)", description: "", winners: 1, questions_per_trial: 3, seconds_per_question: 12,
    starts_at: new Date(Date.now() + 86400e3).toISOString(), ends_at: new Date(Date.now() + 86400e3 + 12 * 3600e3).toISOString(),
    created_by: id, keys_wanted: 5, story_status: "writing", story: nearlyFinished(),
  }).select("id").single();
  if (nearErr) throw nearErr;
  huntIds.push(near.id);
  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });
  let ready = null;
  for (let i = 0; i < 150 && !ready; i++) {
    await wait(2000);
    const { data: h } = await admin.from("hunts").select("story_status, title").eq("id", near.id).single();
    if (h.story_status !== "writing") ready = h;
  }
  check("the nearly finished story runs its map checks and becomes ready", ready?.story_status === "ready", JSON.stringify(ready));
  check("…the hunt takes the story's title", ready?.title === "The Keeper's Last Light", ready?.title);
  const { data: keys } = await admin.from("hunt_keys").select("n, riddle, area_lng, area_lat").eq("hunt_id", near.id).order("n");
  check("…a key at each real place, asked by its question", (keys ?? []).length >= 4 && keys.every((k) => k.riddle.length > 5), (keys ?? []).map((k) => `${k.n}: ${k.area_lat.toFixed(2)},${k.area_lng.toFixed(2)}`).join(" · "));
  const { data: pics } = await admin.from("story_pictures").select("n, prompt, path").eq("hunt_id", near.id).order("n");
  check("…a picture slot per prompt", (pics ?? []).length === 2, `${(pics ?? []).length}`);

  // ---- 4. Upload a picture
  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });
  const png = `${tmpdir()}/loota-test-picture.png`;
  writeFileSync(png, await sharp({ create: { width: 320, height: 180, channels: 3, background: "#7a3a10" } }).png().toBuffer());
  const input = await page.$('[data-picture="1"] input[type="file"]');
  check("the picture slot has a Copy prompt button and an upload", !!input && (await page.evaluate(() => !!document.querySelector('[data-picture="1"]')?.textContent?.includes("Copy prompt"))));
  if (input) await input.uploadFile(png);
  let shown = false;
  for (let i = 0; i < 30 && !shown; i++) {
    await wait(1000);
    shown = await page.evaluate(() => !!document.querySelector('[data-picture="1"] img'));
  }
  const { data: pic } = await admin.from("story_pictures").select("path").eq("hunt_id", near.id).eq("n", 1).single();
  check("…uploaded: it shows, and is saved in Storage", shown && !!pic?.path, pic?.path ?? "");
  await page.evaluate(() => document.querySelector('[data-picture="1"]')?.scrollIntoView());
  await page.screenshot({ path: `${OUT}/story-hunt-2-pictures.png` });

  // ---- 5. The story page
  await page.goto(`http://localhost:3000/admin/story/${near.id}`, { waitUntil: "networkidle2", timeout: 120000 });
  const story = await page.evaluate(() => document.body.innerText);
  check("the story page shows the story and its answers", /The Keeper's Last Light/.test(story) && /Stand-in text/.test(story) && /The answers/.test(story) && /Hook Lighthouse/.test(story));
  await page.screenshot({ path: `${OUT}/story-hunt-3-story.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const h of huntIds) {
    const { data: files } = await admin.storage.from("story-pictures").list(h);
    if (files?.length) await admin.storage.from("story-pictures").remove(files.map((f) => `${h}/${f.name}`));
    await admin.from("story_registry").delete().eq("hunt_id", h);
    await admin.from("hunts").delete().eq("id", h);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test hunts, pictures, registry rows and owner deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
