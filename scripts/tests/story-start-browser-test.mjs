// A story hunt's start (owner, 1 Nov 2026: "Remove the masquerade… since we have the scroll icon… If users knows the
// answer, let them begin to travel when they are ready"). A hunter joins a live story hunt and opens the map:
//   1. no Masquerade scene, no "first riddle is sealed" card;
//   2. the card asks for Key 1's place with no countdown, and the hunter isn't held still;
//   3. after waiting longer than the old 15 seconds, they can still name a place: it locks in (the server agrees).
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
  let box = false;
  for (let i = 0; i < 80 && !box; i++) { box = !!(await page.$('[aria-label="Name the place"]')); if (!box) await wait(500); }
  await wait(3000); // anything that would pop up has had its chance
  const seen = await page.evaluate(() => ({
    masquerade: !!document.querySelector('[role="dialog"][aria-label="Story"]'),
    sealed: !!document.querySelector('[role="dialog"][aria-label="The first riddle"]'),
    box: document.querySelector('[aria-label="Name the place"]')?.innerText ?? "",
    waiting: !!document.querySelector('[aria-label="Waiting"]'),
  }));
  check("no Masquerade scene, no sealed-riddle card", !seen.masquerade && !seen.sealed);
  check("the card asks for Key 1's place, with no countdown", box && seen.box.includes("Where is Key 1? Name the place when you're ready") && !seen.box.includes("⏱") && !seen.waiting, seen.box.slice(0, 80));
  const hp0 = (await admin.from("hunt_players").select("riddle_n, riddle_at").eq("hunt_id", huntId).eq("user_id", id).single()).data;
  check("…the riddle is marked as started (a search still needs a named place)", hp0.riddle_n === 1 && !!hp0.riddle_at);
  await page.screenshot({ path: `${OUT}/story-start.png` });

  // 3. Long past the old 15 seconds: still free to answer
  await admin.from("hunt_players").update({ riddle_at: ago(600) }).eq("hunt_id", huntId).eq("user_id", id);
  const state = await c.rpc("riddle_state", { p_hunt: huntId });
  check("ten minutes on, the clock is still open", state.data?.phase === "open" && state.data?.story === true, JSON.stringify(state.data));
  await page.type('[aria-label="Name the place"] input', "Tafawa Balewa Square");
  let options = 0;
  for (let i = 0; i < 40 && !options; i++) { options = await page.$$eval('[aria-label="Places found"] [role="option"] button', (b) => b.length).catch(() => 0); if (!options) await wait(500); }
  await page.evaluate(() => document.querySelector('[aria-label="Places found"] [role="option"] button')?.click());
  let locked = false;
  for (let i = 0; i < 30 && !locked; i++) { locked = await page.evaluate(() => document.body.innerText.includes("Locked in:")); if (!locked) await wait(500); }
  const hp1 = (await admin.from("hunt_players").select("guess_n, guess_name").eq("hunt_id", huntId).eq("user_id", id).single()).data;
  check("the place locks in, and the server keeps it", locked && hp1.guess_n === 1 && !!hp1.guess_name, `${options} places found; ${hp1.guess_name}`);
  await page.screenshot({ path: `${OUT}/story-start-locked.png` });

  // A penalty's wait still holds: name a place is refused until it ends
  await admin.from("hunt_players").update({ guess_n: null, riddle_n: 1, riddle_at: new Date(Date.now() + 60e3).toISOString() }).eq("hunt_id", huntId).eq("user_id", id);
  const held = await c.rpc("lock_guess", { p_hunt: huntId, p_lng: 3.3958, p_lat: 6.4541, p_name: "Somewhere" });
  const started = await c.rpc("start_riddle", { p_hunt: huntId });
  check("a penalty's wait still holds (and opening the riddle doesn't cut it short)", held.data?.reason === "too_late" && started.data?.phase === "wait", `${held.data?.reason}, ${started.data?.phase}`);
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
