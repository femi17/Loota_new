// Buried treasure and the metal detector, on a phone (owner, 3 Nov 2026: "Make sure the metal detector helps in locating
// where treasures are buried, some houses might be empty, no decoy just nothing. some treasure might be under the
// ground no need to enter a house, the metal detector helps here"). A story key's city: the water tank (open air, the
// right one: the key is buried there), a boiler house (a trap), a drivers' shrine (empty), a llama garden (open air,
// empty) and a salt stall (empty); the hunter has a metal detector:
//   1. 🧭 Explore the place;
//   2. on the street by the water tank's way in: the detector says hot, from the street;
//   3. on the street by the shrine: cold;
//   4. into the shrine (walking in is searching it): empty, nothing at all (no trap, no decoy);
//   5. onto the water tank: no building, ⛏ Dig here: the key's chest comes up; walked up to, its 60-second puzzle
//      opens right there (4 Nov 2026: no longer the map's Key Trial); solved, the key.
// The hunt and the test player are deleted.   SHOTS=<folder> node scripts/tests/buried-treasure-browser-test.mjs
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
const HOUSE = { title: "The salt flat yard", style: "manor", layout: "gallery", items: {}, rooms: [
  { id: "tank", name: "The water tank", kind: "cellar", role: "right", outdoor: true },
  { id: "boilers", name: "The boiler house", kind: "storeroom", role: "trap" },
  { id: "shrine", name: "The drivers' shrine", kind: "chapel", role: "safe" },
  { id: "llamas", name: "The llama garden", kind: "study", role: "safe", outdoor: true },
  { id: "salt", name: "The salt stall", kind: "kitchen", role: "safe" },
] };

try {
  const email = `buried-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500, detector: true, spade: true }).eq("id", id); // a spade: dug at once (by hand: key-world-tools-browser-test)
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Buried treasure browser test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
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
  const idle = () => until(() => page.evaluate((sel) => document.querySelector(sel)?.getAttribute("data-busy") === "false", SCENE), 20000);
  const tap = async (detail) => {
    await idle();
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
    await wait(400);
  };
  const press = (re) => page.evaluate((src, sel) => { const b = [...(document.querySelector(sel) ?? document).querySelectorAll("button")].find((x) => new RegExp(src).test(x.textContent ?? "")); b?.click(); return !!b; }, re, SCENE);
  // The city's own buttons (the map's, behind it, have a Search here of their own)
  const buttonText = () => page.evaluate((sel) => [...(document.querySelector(sel)?.querySelectorAll("button") ?? [])].map((b) => b.textContent?.trim()).join(" | "), SCENE);
  const detector = () => page.evaluate(() => {
    const d = document.querySelector("[data-detector]");
    return d ? { heat: d.getAttribute("data-detector"), at: d.getAttribute("data-detector-at"), text: d.textContent } : null;
  });
  const fronts = () => page.evaluate((sel) => JSON.parse(document.querySelector(sel)?.getAttribute("data-fronts") ?? "{}"), SCENE);
  const toStreetBy = async (room) => {
    const [x, z] = (await fronts())[room];
    await tap({ tap: "hall", x, z });
    return until(async () => {
      const at = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute("data-at"), SCENE);
      const [ax, az] = (at ?? "999,999").split(",").map(Number);
      return Math.hypot(ax - x, az - z) < 0.8;
    }, 20000);
  };

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  // 1. The city
  const go = await until(() => press("Explore the place"), 60000);
  const opened = go && (await until(() => page.evaluate((sel) => !!document.querySelector(sel), SCENE), 15000));
  check("🧭 Explore the place: the city opens", !!opened);
  await wait(1500);
  const placeCount = await page.evaluate((sel) => Object.keys(JSON.parse(document.querySelector(sel)?.getAttribute("data-fronts") ?? "{}")).length, SCENE);
  check("its five places, each with its way in", placeCount === 5, String(placeCount));

  // 2. On the street by the water tank: hot, from the street
  check("on the street by the water tank's way in", !!(await toStreetBy("tank")));
  const hot = await until(async () => { const d = await detector(); return d?.heat === "hot" && d.at === "tank" ? d : null; }, 10000);
  check("…the detector, from the street: hot (the water tank)", !!hot, JSON.stringify(await detector()));
  check("…and no Search or Dig from the street", !/Search here|Dig here/.test(await buttonText()));
  await wait(800);
  await page.screenshot({ path: `${OUT}/buried-1-street-hot.png` });

  // 3. By the shrine: cold
  await toStreetBy("shrine");
  const cold = await until(async () => { const d = await detector(); return d?.at === "shrine" && d.heat === "cold" ? d : null; }, 10000);
  check("on the street by the shrine: cold", !!cold, JSON.stringify(await detector()));

  // 4. Into the shrine: searched, empty (nothing at all)
  await tap({ tap: "room", id: "shrine" });
  await until(async () => /Inside The drivers' shrine/.test(await say()), 20000);
  await idle();
  check("in the shrine (a building): no Dig button (going in was the search)", !/Dig here/.test(await buttonText()), await buttonText());
  const empty = await until(async () => /nothing here\. It's empty/.test(await say()) && (await say()), 15000);
  check("…empty: just nothing", !!empty, empty ?? (await say()));
  const trapCard = await page.evaluate(() => !!document.querySelector('[aria-label^="A trap:"]'));
  check("…no trap, no decoy", !trapCard);

  // 5. The water tank: open air, dig: the key's chest; its puzzle, 60 seconds; the key
  await tap({ tap: "room", id: "tank" });
  const there = await until(async () => /At The water tank, out in the open/.test(await say()) && (await say()), 20000);
  check("onto the water tank: out in the open", !!there, there ?? (await say()));
  await idle();
  const dig = await until(async () => /Dig here/.test(await buttonText()), 10000);
  check("on the water tank (open air): ⛏ Dig here, not Search", !!dig && !/Search here/.test(await buttonText()), await buttonText());
  await press("Dig here");
  const chest = await until(async () => /key's chest/.test(await say()) && (await say()), 15000);
  check("dug: the key's chest comes up", !!chest, chest ?? (await say()));
  await wait(1200);
  await page.screenshot({ path: `${OUT}/buried-2-chest.png` });
  await tap({ tap: "inner", id: "1" });
  const sheet = await until(() => page.evaluate(() => !!document.querySelector('[data-room-puzzle="1"]')), 20000);
  check("walked up to the chest: its puzzle opens, here in the world", !!sheet && !!(await page.$(SCENE)));
  const left = Number(await page.evaluate(() => document.querySelector("[data-room-left]")?.getAttribute("data-room-left")));
  check("…60 seconds for its puzzle", left > 45 && left <= 60, `${left} s`);
  await wait(800);
  await page.screenshot({ path: `${OUT}/buried-3-trial.png` });
  const stored = (await admin.from("house_room_puzzles").select("kind, solution").eq("user_id", id).eq("hunt_id", huntId).eq("room", 1).single()).data;
  await page.evaluate((a) => window.__lootaRoomSolve?.(a), stored.kind === "sentries" ? stored.solution.map((col, row) => [row, col]) : stored.solution);
  const card = await until(() => page.evaluate(() => /Key 1 earned/.test(document.body.innerText)), 20000);
  const held = (await admin.from("hunt_players").select("keys_held").eq("hunt_id", huntId).eq("user_id", id).single()).data.keys_held;
  check("solved: the key (Key 1 held)", !!card && held === 1, `card ${!!card}, keys_held ${held}`);
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
