// The hunt city on a phone (owner, 3 Nov 2026: "see an example of our hunt city… If a user uses the metal detector to
// locate where the treasure is located, then go in, we open the roof of the building, and they complete the puzzle…
// room 1, coins, room 2, the next chapter, room 3, the key, room 4, decoy trap, another room trap. But all these will
// be shuffled"). A story key's city: a noodle shop (the right one), a fountain house (a trap) and a bookshop; the
// hunter has a metal detector:
//   1. 🧭 Explore the place: the city, its buildings and their names;
//   2. into the fountain house: going in springs its trap (the key's world, 3 Nov 2026); the detector says cold;
//      dodged;
//   3. into the noodle shop: hot; walked into, the key's chest;
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
  const frontsOf = () => page.evaluate((sel) => Object.keys(JSON.parse(document.querySelector(sel)?.getAttribute("data-fronts") ?? "{}")).join(" | "), SCENE);
  const fronts = (await until(async () => (await frontsOf()) || null, 15000)) ?? "";
  check("…its buildings, each with its way in", /noodles/.test(fronts) && /fountain/.test(fronts) && /books/.test(fronts), fronts);
  await page.evaluate(() => document.querySelector('button[aria-label="See the whole place"]')?.click());
  await wait(1500);
  await page.screenshot({ path: `${OUT}/city-1-streets.png` });
  await page.evaluate(() => document.querySelector('button[aria-label="Back to where you are"]')?.click());

  // 2. Into the fountain house (a trap: going in springs it), the detector cold (it finds only the key); dodged
  await tap({ tap: "room", id: "fountain" });
  const trapped = await until(() => page.evaluate(() => !!document.querySelector('[aria-label="Dodge the trap"]')), 20000);
  check("into the fountain house: its trap springs", !!trapped, await say());
  const cold = await until(async () => (await detector()) === "cold", 10000);
  check("…the detector: cold", !!cold, String(await detector()));
  await page.screenshot({ path: `${OUT}/city-2-roof-off.png` });
  const dodgeAnswer = (await admin.from("hunt_players").select("house_dodge").eq("hunt_id", huntId).eq("user_id", id).single()).data?.house_dodge?.answer;
  await page.evaluate((k) => document.querySelectorAll('[aria-label="Dodge the trap"] .grid button')[Number(k) - 1]?.click(), dodgeAnswer);
  check("…dodged", !!(await until(async () => /dodged it/.test(await say()), 10000)), await say());

  // 3. The noodle shop: hot; walked into, its five rooms
  await tap({ tap: "room", id: "noodles" });
  const hot = await until(async () => (await detector()) === "hot", 15000);
  check("into the noodle shop: the detector says hot", !!hot, String(await detector()));
  const rooms = await until(async () => /key's chest/.test(await say()) && (await say()), 20000);
  check("🔍 walked in: the key's chest, locked", !!rooms, rooms ?? (await say()));
  await wait(1200);
  await page.screenshot({ path: `${OUT}/city-3-rooms.png` });

  // 4. The boxes in the town's houses (the coins, the next chapter, a fake chest, a trap: each in a house of its own),
  //    then the key's chest in the noodle shop
  const seen = [];
  const housesSeen = [];
  const answerOf = (stored) => (stored.kind === "sentries" ? stored.solution.map((col, row) => [row, col]) : stored.solution);
  let keyed = false;
  for (const n of [2, 3, 4, 5, 1]) {
    if (!(await inCity())) await explore();
    await tap({ tap: "inner", id: String(n) });
    const sheet = await until(() => page.evaluate((k) => !!document.querySelector(`[data-room-puzzle="${k}"]`), n), 30000);
    if (!sheet) {
      check(`box ${n}: its puzzle`, false, await say());
      continue;
    }
    if (n !== 1) housesSeen.push(await page.evaluate((sel) => document.querySelector(sel)?.getAttribute("data-home"), SCENE));
    if (n === 2) {
      await page.screenshot({ path: `${OUT}/city-4-room-puzzle.png` });
      await page.evaluate(() => window.__lootaRoomSolve?.(["WRONG"]));
      const wrong = await until(async () => /Not quite/.test(await page.evaluate(() => document.body.innerText)), 10000);
      check("a wrong answer: the box stays shut", !!wrong);
      // Each puzzle its own time (owner, 8 Nov 2026; it was 60 s for all): the clock shows it; past it, the answer is too
      // late and the lock jams for 30 s
      const left = Number(await page.evaluate(() => document.querySelector("[data-room-left]")?.getAttribute("data-room-left")));
      const first = (await admin.from("house_room_puzzles").select("kind, solution, tries, seconds").eq("user_id", id).eq("hunt_id", huntId).eq("room", 2).single()).data;
      check(`the box's clock: its own time (${first.kind}, ${first.seconds} s)`, left > first.seconds - 15 && left <= first.seconds, `${left} s`);
      await admin.from("house_room_puzzles").update({ started_at: ago(first.seconds + 10) }).eq("user_id", id).eq("hunt_id", huntId).eq("room", 2);
      await page.evaluate((a) => window.__lootaRoomSolve?.(a), answerOf(first));
      const late = await until(async () => /Too slow/.test(await say()) && !(await page.evaluate(() => !!document.querySelector("[data-room-puzzle]"))) && (await say()), 10000);
      check("the right answer, after its time: too late, the sheet closes", !!late, late ?? (await say()));
      await tap({ tap: "inner", id: "2" });
      const jammed = await until(async () => /jammed/.test(await say()) && (await say()), 10000);
      check("…the lock is jammed for a while", !!jammed, jammed ?? (await say()));
      await admin.from("house_room_puzzles").update({ started_at: ago(first.seconds + 40) }).eq("user_id", id).eq("hunt_id", huntId).eq("room", 2);
      await tap({ tap: "inner", id: "2" });
      const again = await until(() => page.evaluate(() => !!document.querySelector('[data-room-puzzle="2"]')), 15000);
      const next = (await admin.from("house_room_puzzles").select("tries, solved_at").eq("user_id", id).eq("hunt_id", huntId).eq("room", 2).single()).data;
      check("…after the jam: a new puzzle, a new try", !!again && next.tries === first.tries + 1 && !next.solved_at, `tries ${first.tries} → ${next.tries}`);
    }
    const stored = (await admin.from("house_room_puzzles").select("kind, solution").eq("user_id", id).eq("hunt_id", huntId).eq("room", n).single()).data;
    await page.evaluate((a) => window.__lootaRoomSolve?.(a), answerOf(stored));
    const said = await until(async () => { const t = await say(); return (n === 1 ? /The key's chest: / : /The box: /).test(t) ? t : null; }, 15000);
    const outcome = (await admin.from("house_room_puzzles").select("outcome").eq("user_id", id).eq("hunt_id", huntId).eq("room", n).single()).data?.outcome;
    seen.push(outcome);
    check(`${n === 1 ? "the key's chest" : `box ${n}`} (${stored.kind}) solved: ${outcome}`, !!said && !!outcome, said ?? "");
    if (outcome === "decoy" || outcome === "trap") {
      const card = await until(() => page.evaluate(() => !!document.querySelector('[aria-label^="A trap:"]')), 10000);
      check(`…its penalty card`, !!card);
      await page.screenshot({ path: `${OUT}/city-5-${outcome}.png` });
      await press("Get up");
      await admin.from("player_positions").update({ lng: PLACE.lng, lat: PLACE.lat, updated_at: ago(30) }).eq("user_id", id); // back at the place (a test shortcut)
      await admin.from("hunt_players").update({ house_out_until: null }).eq("hunt_id", huntId).eq("user_id", id);
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
  check("the four boxes: four different houses", housesSeen.length === 4 && new Set(housesSeen).size === 4 && housesSeen.every((h) => Number(h) >= 0), housesSeen.join(", "));
  check("the coins, the chapter, a fake chest and a trap in the houses, the key in its chest", keyed && seen[4] === "key" && new Set(seen.slice(0, 4)).size === 4 && !seen.slice(0, 4).includes("key"), seen.join(", "));
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
