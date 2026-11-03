// The key's quarter on a phone (owner, 1 Nov 2026: "our own open street… where user can walk freely… to figure where
// the treasure is actually buried"; it replaced the house). A story key with the test house (see house-api-test: its
// rooms are the quarter's plots: a study with a portrait hiding a brass key, a cellar and a kitchen that are traps, a
// locked bedroom with the chest). The hunter stands at the place:
//   1. "🧭 Explore the place" on the map; the quarter opens (3D, its plots, the hunter);
//   2. the bedroom's door is shut; walking into the cellar springs its trap (the key's world, 3 Nov 2026: going in
//      is searching): the soft penalty card, thrown out;
//   3. back in: walking into the kitchen, the trap dodged; the study's portrait gives the brass key;
//   4. the bedroom's door opens with it; walked into (the right one), its five rooms (key-world-browser-test plays
//      them);
//   5. a real tap in the world walks the hunter (the 3D picking works).
// The hunt and test player are deleted.   SHOTS=<folder> node scripts/tests/house-browser-test.mjs
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
const PLACE = { lng: 3.3958, lat: 6.4541 };
const HOUSE = {
  title: "The keeper's house",
  style: "keeper",
  items: { "brass-key": { name: "A small brass key", icon: "🗝️" } },
  rooms: [
    { id: "study", name: "Study", kind: "study", role: "safe", objects: [
      { id: "portrait", kind: "picture", label: "An old man's portrait", look: "A stern old man in a sailor's cap.", gives: "brass-key", found: "You lift the frame. Taped to the back: a small brass key." },
      { id: "desk", kind: "desk", label: "A writing desk", look: "Bills, a pencil, a dried-up inkwell." },
    ] },
    { id: "cellar", name: "Cellar", kind: "cellar", role: "trap" },
    { id: "kitchen", name: "Kitchen", kind: "kitchen", role: "trap" },
    { id: "bedroom", name: "Bedroom", kind: "bedroom", role: "right", needs: "brass-key", lockedText: "Locked. A small brass keyhole.", objects: [{ id: "clock", kind: "clock", label: "A tall clock", look: "It stopped at twelve." }] },
  ],
};

try {
  const email = `housebr-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500 }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "House test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where was the light?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng, area_lat: PLACE.lat, area_radius_m: 1500, spot_lng: PLACE.lng, spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "The light", guess_lng: PLACE.lng, guess_lat: PLACE.lat });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
  }, huntId, id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });

  const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
  const button = async (re) => page.evaluateHandle((src) => [...document.querySelectorAll("button")].find((b) => new RegExp(src).test(b.textContent ?? "")) ?? null, re);
  const say = () => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "");
  const SCENE = '[aria-label="The key\'s place"]';
  const idle = () => until(() => page.evaluate((sel) => document.querySelector(sel)?.getAttribute("data-busy") === "false", SCENE), 20000);
  const tap = async (detail) => {
    await idle(); // one thing at a time (a tap while busy is ignored)
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
    await wait(300);
  };
  /** Walk into a place (going in is searching it). */
  const walkIn = (room) => tap({ tap: "room", id: room });
  const where = () => page.evaluate((sel) => document.querySelector(sel)?.getAttribute("data-at") ?? "", SCENE);
  const explore = async () => (await until(async () => (await (await button("Explore the place")).jsonValue()) !== null && (await button("Explore the place")), 60000));

  // 1. Explore the place
  const go = await explore();
  check("at the place: 🧭 Explore the place", !!go);
  await page.screenshot({ path: `${OUT}/house-0-map.png` });
  await go.click();
  const inside = await until(() => page.evaluate((sel) => !!document.querySelector(`${sel} canvas`) && document.body.innerText.includes("The keeper's house"), SCENE));
  check("the quarter opens: 3D, with its name", !!inside);
  await wait(1500);
  await page.screenshot({ path: `${OUT}/house-1-inside.png` });

  // 5. A real tap in the quarter walks the hunter
  const before = await where();
  let afterTap = null;
  for (const [fx, fy] of [[0.5, 0.3], [0.35, 0.35], [0.65, 0.35]]) {
    const box = await page.evaluate((x, y) => { const r = document.querySelector("[data-house] canvas").getBoundingClientRect(); return { x: r.left + r.width * x, y: r.top + r.height * y }; }, fx, fy);
    await page.mouse.click(box.x, box.y);
    afterTap = await until(async () => (await where()) !== before && (await where()), 3000);
    if (afterTap) break;
  }
  check("a real tap in the world walks the hunter there", !!afterTap, `${before} → ${afterTap}`);
  await wait(1500);

  // 2. A shut door; a trap walked into
  await tap({ tap: "room", id: "bedroom" });
  const locked = await until(async () => /Locked\. A small brass keyhole/.test(await say()) && (await say()), 20000);
  check("the bedroom: its door is shut, with its hint", !!locked, locked ?? (await say()));
  await walkIn("cellar");
  const challenge = await until(() => page.evaluate(() => document.querySelector('[aria-label="Dodge the trap"]')?.innerText ?? null), 20000);
  const answers = await page.evaluate(() => document.querySelectorAll('[aria-label="Dodge the trap"] button').length);
  check("walking into the cellar: a trap! a challenge to dodge it, with 4 answers", !!challenge && answers === 4, `${answers} answers: ${challenge?.replace(/\s+/g, " ").slice(0, 100)}`);
  await page.screenshot({ path: `${OUT}/house-2-dodge.png` });
  const pending = (await admin.from("hunt_players").select("house_dodge").eq("hunt_id", huntId).eq("user_id", id).single()).data.house_dodge;
  await page.evaluate((n) => document.querySelectorAll('[aria-label="Dodge the trap"] button')[n - 1].click(), pending.answer === 1 ? 2 : 1);
  await wait(900);
  const card = await until(() => page.evaluate(() => document.querySelector('[role="alertdialog"][data-penalty]')?.innerText ?? null), 20000);
  check("…the trap springs: the soft penalty card, thrown out", !!card && /WRONG SPOT/i.test(card) && !(await page.$(SCENE)), card?.replace(/\s+/g, " ").slice(0, 120));
  await page.screenshot({ path: `${OUT}/house-2-trap.png` });
  await (await button("Get up")).click();
  await admin.from("hunt_players").update({ house_out_until: null }).eq("hunt_id", huntId).eq("user_id", id);

  // 3. Back in: a dodged trap, then the study's portrait
  await (await explore()).click();
  await until(() => page.evaluate((sel) => !!document.querySelector(`${sel} canvas`), SCENE));
  await wait(800);
  await walkIn("kitchen");
  await until(() => page.evaluate(() => !!document.querySelector('[aria-label="Dodge the trap"]')), 20000);
  const answer = (await admin.from("hunt_players").select("house_dodge").eq("hunt_id", huntId).eq("user_id", id).single()).data.house_dodge.answer;
  await page.evaluate((n) => document.querySelectorAll('[aria-label="Dodge the trap"] button')[n - 1].click(), answer);
  const dodged = await until(async () => /You dodged it/.test(await say()) && (await say()), 15000);
  check("walking into the kitchen: the right answer in time, dodged, still here", !!dodged && !(await page.$('[role="alertdialog"][data-penalty]')) && !!(await page.$(SCENE)), dodged ?? (await say()));
  await wait(3500); // a breather after a dodge
  await tap({ tap: "object", id: "portrait" });
  const found = await until(async () => /Taped to the back/.test(await say()) && (await say()), 20000);
  const carried = await page.evaluate(() => document.querySelector('[aria-label="What you carry"]')?.textContent ?? "");
  check("the study's portrait: the brass key, carried", !!found && carried.includes("A small brass key"), `${found} | ${carried}`);
  await page.screenshot({ path: `${OUT}/house-3-key.png` });

  // 4. The bedroom's door, walked up to with the brass key; in: its five rooms
  await tap({ tap: "room", id: "bedroom" });
  const opened = await until(async () => /(gate|door) of Bedroom opens/.test(await say()) && (await say()), 20000);
  check("the bedroom's door opens with the brass key", !!opened, opened ?? (await say()));
  await walkIn("bedroom");
  const rooms = await until(async () => /Five rooms/.test(await say()) && (await say()), 25000);
  check("walking into the bedroom (the right one): its five rooms", !!rooms, rooms ?? (await say()));
  await wait(600);
  await page.screenshot({ path: `${OUT}/house-4-rooms.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
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
