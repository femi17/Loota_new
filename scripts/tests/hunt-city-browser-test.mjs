// The hunt city on a phone (owner, 3 Nov 2026: "see an example of our hunt city… If a user uses the metal detector to
// locate where the treasure is located, then go in, we open the roof of the building, and they complete the puzzle…
// room 1, coins, room 2, the next chapter, room 3, the key, room 4, decoy trap, another room trap. But all these will
// be shuffled"). A story key's city: a noodle shop (the right one), a fountain house (a trap) and a bookshop; the
// hunter has a metal detector:
//   1. 🧭 Explore the place: the city, its buildings and their names;
//   2. into the fountain house: its roof lifts off; the detector says warm; out again;
//   3. into the noodle shop: hot; 🔍 Search here: its five rooms;
//   4. room by room: each door opens on its puzzle; solved, it opens on what it held (coins, the next chapter, a
//      decoy, a trap: their penalty card), until the key: the city closes and the hunt card has Key 1.
// The hunt and the test player are deleted.   SHOTS=<folder> node scripts/tests/hunt-city-browser-test.mjs
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
const HOUSE = { title: "The noodle quarter", style: "manor", layout: "gallery", items: {}, rooms: [
  { id: "noodles", name: "The noodle shop", kind: "kitchen", role: "right" },
  { id: "fountain", name: "The fountain house", kind: "bathroom", role: "trap" },
  { id: "books", name: "The bookshop", kind: "library", role: "safe" },
] };

try {
  const email = `citybr-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500, detector: true }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "City browser test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  for (const n of [1, 2]) {
    await admin.from("hunt_keys").insert({ hunt_id: huntId, n, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng + (n - 1) * 0.05, area_lat: PLACE.lat, area_radius_m: 1500,
      spot_lng: PLACE.lng + (n - 1) * 0.05, spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
  }
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "The place", guess_lng: PLACE.lng, guess_lat: PLACE.lat, leg_lng: PLACE.lng, leg_lat: PLACE.lat });

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
  const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
  const say = () => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "");
  const SCENE = '[aria-label="The key\'s place"]';
  const inCity = () => page.evaluate((sel) => !!document.querySelector(sel), SCENE);
  const idle = () => until(() => page.evaluate((sel) => document.querySelector(sel)?.getAttribute("data-busy") === "false", SCENE), 20000);
  const tap = async (detail) => {
    await idle();
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
    await wait(400);
  };
  const press = (re) => page.evaluate((src) => { const b = [...document.querySelectorAll("button")].find((x) => new RegExp(src).test(x.textContent ?? "")); b?.click(); return !!b; }, re);
  const detector = () => page.evaluate(() => document.querySelector("[data-detector]")?.getAttribute("data-detector") ?? null);
  const explore = async () => {
    const go = await until(() => press("Explore the place"), 60000);
    if (go) await until(inCity, 15000);
    await wait(1500);
    return !!go;
  };

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  // 1. The city
  check("🧭 Explore the place: the city opens", await explore());
  const names = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Buildings"] button')].map((b) => b.textContent?.trim()).join(" | "));
  check("…its buildings, by name", /noodle shop/.test(names) && /fountain house/.test(names) && /bookshop/.test(names), names);
  await page.evaluate(() => document.querySelector('button[aria-label="See the whole place"]')?.click());
  await wait(1500);
  await page.screenshot({ path: `${OUT}/city-1-streets.png` });
  await page.evaluate(() => document.querySelector('button[aria-label="Back to where you are"]')?.click());

  // 2. Into the fountain house: the roof lifts, the detector says warm
  await tap({ tap: "room", id: "fountain" });
  const inside = await until(async () => /Inside The fountain house/.test(await say()) && (await say()), 20000);
  check("into the fountain house", !!inside, inside ?? (await say()));
  const warm = await until(async () => (await detector()) === "warm", 10000);
  check("…the detector: warm", !!warm, String(await detector()));
  await wait(1200);
  await page.screenshot({ path: `${OUT}/city-2-roof-off.png` });

  // 3. The noodle shop: hot; searched, its five rooms
  await tap({ tap: "room", id: "noodles" });
  const hot = await until(async () => (await detector()) === "hot", 15000);
  check("into the noodle shop: the detector says hot", !!hot, String(await detector()));
  await idle();
  await until(() => press("Search here"), 15000);
  const rooms = await until(async () => /Five rooms/.test(await say()) && (await say()), 20000);
  check("🔍 searched: its five rooms", !!rooms, rooms ?? (await say()));
  await wait(1200);
  await page.screenshot({ path: `${OUT}/city-3-rooms.png` });

  // 4. Room by room, until the key
  const seen = [];
  let keyed = false;
  for (let n = 1; n <= 5 && !keyed; n++) {
    if (!(await inCity())) await explore();
    await tap({ tap: "inner", id: String(n) });
    const sheet = await until(() => page.evaluate((k) => !!document.querySelector(`[data-room-puzzle="${k}"]`), n), 20000);
    if (!sheet) {
      check(`room ${n}: its puzzle`, false, await say());
      continue;
    }
    if (n === 1) {
      await page.screenshot({ path: `${OUT}/city-4-room-puzzle.png` });
      await page.evaluate(() => window.__lootaRoomSolve?.(["WRONG"]));
      const wrong = await until(async () => /Not quite/.test(await page.evaluate(() => document.body.innerText)), 10000);
      check("a wrong answer: the door stays shut", !!wrong);
    }
    const stored = (await admin.from("house_room_puzzles").select("kind, solution").eq("user_id", id).eq("hunt_id", huntId).eq("room", n).single()).data;
    const answer = stored.kind === "sentries" ? stored.solution.map((col, row) => [row, col]) : stored.solution;
    await page.evaluate((a) => window.__lootaRoomSolve?.(a), answer);
    const said = await until(async () => { const t = await say(); return new RegExp(`Room ${n}:`).test(t) ? t : null; }, 15000);
    const outcome = (await admin.from("house_room_puzzles").select("outcome").eq("user_id", id).eq("hunt_id", huntId).eq("room", n).single()).data?.outcome;
    seen.push(outcome);
    check(`room ${n} (${stored.kind}) solved: ${outcome}`, !!said && !!outcome, said ?? "");
    if (outcome === "decoy" || outcome === "trap") {
      const card = await until(() => page.evaluate(() => !!document.querySelector('[aria-label^="A trap:"]')), 10000);
      check(`…its penalty card`, !!card);
      await page.screenshot({ path: `${OUT}/city-5-${outcome}.png` });
      await press("Get up");
      await admin.from("player_positions").update({ lng: PLACE.lng, lat: PLACE.lat, updated_at: ago(30) }).eq("user_id", id); // back at the place (a test shortcut)
      await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    }
    if (outcome === "key") {
      keyed = true;
      const closed = await until(async () => !(await inCity()), 10000);
      const card = await until(() => page.evaluate(() => /Key 1 earned/.test(document.body.innerText)), 15000);
      const held = (await admin.from("hunt_players").select("keys_held").eq("hunt_id", huntId).eq("user_id", id).single()).data.keys_held;
      check("the key: the city closes, the hunt card has it, Key 1 held", !!closed && !!card && held === 1, `closed ${!!closed}, card ${!!card}, keys_held ${held}`);
      await wait(1500);
      await page.screenshot({ path: `${OUT}/city-6-key.png` });
    }
  }
  check("rooms until the key, each different", keyed && new Set(seen).size === seen.length, seen.join(", "));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("house_room_puzzles").delete().eq("hunt_id", huntId);
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
