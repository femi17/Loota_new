// A story hunt's start (owner, 1 Nov 2026: "Remove the masquerade… since we have the scroll icon… If users knows the
// answer, let them begin to travel when they are ready"; then "do we need a modal asking where…? We do not need that.
// We have a search icon"). A hunter joins a live story hunt and opens the map:
//   1. no Masquerade scene, no "first riddle is sealed" card;
//   2. no box to name the place and no countdown: a line points to the story and Directions; nothing is started;
//   3. opening and closing the story scroll draws no route (a tap on the map itself still does);
//   4. a penalty's wait still holds the hunter.
// The hunt and test player are deleted.   SHOTS=<folder> node scripts/tests/story-start-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const work = { keys: 1, writer: "test", designs: {}, decoys: {}, map: {}, spent: {}, done: true, log: [], skeleton: { title: "Start test", logline: "A test story.", villain: { name: "x", motive: "x" }, heroes: [], worldRules: [], chapters: [{ n: 0, title: "One", setting: "Here", beats: [], plants: [] }, { n: 1, title: "Two", setting: "There", beats: [], plants: [] }], keys: [] }, chapters: { 0: { text: "A first chapter.", leaks: [] }, 1: { text: "A second chapter.", leaks: [] } } };

try {
  const email = `start-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: 3.3787, lat: 6.5186, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Story start test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true, story: work, story_status: "ready" }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where did the test begin?", category: "general", trial_kind: "sentries", area_lng: 3.3958, area_lat: 6.4541, area_radius_m: 1500, spot_lng: 3.3958, spot_lat: 6.4541, exact_m: 120 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 860 });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });

  // 1–2. The start
  let card = false;
  for (let i = 0; i < 80 && !card; i++) { card = await page.evaluate(() => document.body.innerText.includes("The story (📜) says where")); if (!card) await wait(500); }
  await wait(3000); // anything that would pop up has had its chance
  const seen = await page.evaluate(() => ({
    masquerade: !!document.querySelector('[role="dialog"][aria-label="Story"]'),
    sealed: !!document.querySelector('[role="dialog"][aria-label="The first riddle"]'),
    box: !!document.querySelector('[aria-label="Name the place"]'),
    clock: document.body.innerText.includes("⏱"),
  }));
  check("no Masquerade scene, no sealed-riddle card", !seen.masquerade && !seen.sealed);
  check("no box to name the place, no countdown: a line points to the story and Directions", card && !seen.box && !seen.clock);
  const hp0 = (await admin.from("hunt_players").select("riddle_n").eq("hunt_id", huntId).eq("user_id", id).single()).data;
  check("…and nothing is started (a search never waits for a named place)", hp0.riddle_n === null);
  await page.screenshot({ path: `${OUT}/story-start.png` });

  // 3. The scroll, opened and closed
  await page.evaluate(() => document.querySelector('[data-tool="story"]').click());
  for (let i = 0; i < 20 && !(await page.$('[aria-label="Close the scroll"]')); i++) await wait(300);
  const x = await (await page.$('[aria-label="Close the scroll"]')).boundingBox();
  await page.mouse.click(x.x + x.width / 2, x.y + x.height / 2);
  await wait(2500);
  const after = await page.evaluate(() => document.body.innerText);
  check("closing the scroll draws no route", !(await page.$('[aria-label="Close the scroll"]')) && !/Finding a route|marked spot/i.test(after));

  const canvas = await (await page.$("canvas.maplibregl-canvas")).boundingBox();
  await page.mouse.click(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.8);
  let routed = false;
  for (let i = 0; i < 20 && !routed; i++) { routed = await page.evaluate(() => /Finding a route|marked spot|blue line|min/i.test(document.body.innerText)); if (!routed) await wait(300); }
  check("…while a tap on the map itself still plans a route", routed);

  // 4. A penalty's wait still holds
  await admin.from("hunt_players").update({ riddle_at: new Date(Date.now() + 60e3).toISOString() }).eq("hunt_id", huntId).eq("user_id", id);
  const held = await c.rpc("riddle_state", { p_hunt: huntId });
  check("a penalty's wait still holds the hunter", held.data?.phase === "wait", JSON.stringify(held.data));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
