// The key's world on a phone (owner, 3 Nov 2026, after the old mini-Loota: "when you get to the location you are
// thrown into another world. You can even mimic the key location… user can move freely using the movement we have
// designed"; "we would still have a trap if some enters the wrong house, the metal detector should only detect the key
// not the next chapter or the coins"). Key 1 of a story set at a station with a bronze dog on a scramble crossing; the
// hunter has a metal detector:
//   1. 🧭 Explore the place: the world opens round its landmark (no buttons for the places);
//   2. walking (the arrow keys): the hunter moves, and a wall stops them;
//   3. into the wishing fountain (a trap) just by walking in: its challenge, dodged;
//   4. into the comic book stall: empty, nothing at all;
//   5. the finds spread over the town (owner, 4 Nov 2026: "do not keep all the item in one house… Let all the small
//      house be able to enter"): four locked boxes in four small houses, walked into; into the noodle stall (the right
//      one): the key's chest;
//      key's room;
//   6. walking up to the key's chest: its puzzle opens; solved: the first of three locks (owner, 12 Nov 2026), no key yet
//      (the chain to the key: key-chain-browser-test).
// The hunt and the test player are deleted.   SHOTS=<folder> node scripts/tests/key-world-browser-test.mjs
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
const PLACE = { lng: 139.7005, lat: 35.6591 };
const HOUSE = { title: "Kumiko's corner by the station", style: "manor", items: {}, scene: { ground: "city", pieces: ["station", "dog-statue", "scramble", "screens"] }, rooms: [
  { id: "noodles", name: "The noodle stall", kind: "kitchen", role: "right" },
  { id: "fountain", name: "The wishing fountain", kind: "bathroom", role: "trap" },
  { id: "bikes", name: "The bicycle yard", kind: "storeroom", role: "trap", outdoor: true },
  { id: "manga", name: "The comic book stall", kind: "library", role: "safe" },
  { id: "garden", name: "The little garden", kind: "study", role: "safe", outdoor: true },
] };

try {
  const email = `keyworld-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 139.69, home_lat: 35.66, home_set_at: new Date().toISOString(), coins: 500, detector: true }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Key world browser test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
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
  // Light to draw (the 5-second dodge needs a quick page)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
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
  const SCENE = '[aria-label="The key\'s place"]';
  const say = () => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "");
  const attr = (name) => page.evaluate((sel, n) => document.querySelector(sel)?.getAttribute(n), SCENE, name);
  const where = async () => (await attr("data-at") ?? "0,0").split(",").map(Number);
  const idle = () => until(async () => (await attr("data-busy")) === "false", 20000);
  const tap = async (detail) => {
    await idle();
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
    await wait(300);
  };
  const press = (re) => page.evaluate((src, sel) => { const b = [...(document.querySelector(sel) ?? document).querySelectorAll("button")].find((x) => new RegExp(src).test(x.textContent ?? "")); b?.click(); return !!b; }, re, SCENE);
  const detector = () => page.evaluate(() => {
    const d = document.querySelector("[data-detector]");
    return d ? { heat: d.getAttribute("data-detector"), at: d.getAttribute("data-detector-at") } : null;
  });
  const inside = () => attr("data-inside");

  // On a laptop first (its own page, closed before the phone joins: one device a player): the hunter in the middle of the screen; the mouse wheel zooms out
  {
    const lap = await browser.newPage();
    await lap.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
    await lap.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await lap.evaluateOnNewDocument((h, uid) => {
      try {
        localStorage.setItem(`loota:riddle-seen:${h}`, "1");
        localStorage.setItem(`loota:welcome:${uid}`, "1");
        localStorage.setItem(`loota:story:${h}:start`, "1");
      } catch {}
    }, huntId, id);
    await lap.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await until(() => lap.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Explore the place/.test(x.textContent ?? "")); b?.click(); return !!b; }), 60000);
    await until(() => lap.evaluate((sel) => !!document.querySelector(sel), SCENE), 15000);
    await wait(2500);
    await lap.screenshot({ path: `${OUT}/world-2a-laptop.png` });
    await lap.mouse.move(683, 384);
    for (let k = 0; k < 6; k++) await lap.mouse.wheel({ deltaY: 120 });
    await wait(1500);
    await lap.screenshot({ path: `${OUT}/world-2a-laptop-out.png` });
    await lap.close();
  }
  await wait(1500);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  // 1. The world
  const go = await until(() => press("Explore the place"), 60000);
  const opened = go && (await until(() => page.evaluate((sel) => !!document.querySelector(sel), SCENE), 15000));
  check("🧭 Explore the place: the world opens", !!opened);
  await wait(2500);
  const buttons = await page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean), SCENE);
  check("no buttons for the places (only the map and Leave)", !buttons.some((b) => /noodle|fountain|comic|garden|bicycle/i.test(b)), buttons.join(" | "));
  await page.screenshot({ path: `${OUT}/world-1-arrive.png` });
  // Not given away on arrival (owner, 8 Nov 2026: "The room should not be an obvious find, they should walk around
  // before seeing it"): with a detector in hand, standing where they arrive, no beeping and no place read hot yet.
  const arriveBeeps0 = await page.evaluate(() => (window.__lootaCues ?? []).filter((c) => c === "beep").length);
  await wait(2500);
  const arriveBeeps = (await page.evaluate(() => (window.__lootaCues ?? []).filter((c) => c === "beep").length)) - arriveBeeps0;
  check("arrived with a detector: no beeping yet (it reads a place only from close by)", arriveBeeps === 0 && (await attr("data-beep")) == null, `${arriveBeeps} beeps`);

  // 2. Walking: the arrow keys move the hunter; a wall stops them
  await until(async () => (await attr("data-at")) != null && !(await page.$('[aria-label="Open on more than one device"]')), 15000);
  const [x0, z0] = await where();
  await page.keyboard.down("ArrowUp");
  await wait(1500);
  await page.keyboard.up("ArrowUp");
  await wait(300);
  const [x1, z1] = await where();
  check("the arrow keys walk the hunter (up the screen)", z1 < z0 - 3 && Math.abs(x1 - x0) < 0.5, `${z0.toFixed(1)} → ${z1.toFixed(1)}`);
  // …and only there: the map underneath stands still (owner, 4 Nov 2026: "my viehicle move away from the key location")
  await wait(2500);
  const onMap = (await admin.from("player_positions").select("lng, lat").eq("user_id", id).single()).data;
  const drift = Math.hypot((onMap.lng - PLACE.lng) * 111320 * Math.cos((PLACE.lat * Math.PI) / 180), (onMap.lat - PLACE.lat) * 110574);
  check("…the map underneath doesn't move (still at the key)", drift < 60, `${Math.round(drift)} m from the key`);
  await page.screenshot({ path: `${OUT}/world-2-square.png` });
  await page.evaluate(() => document.querySelector('button[aria-label="See the whole place"]')?.click());
  await wait(2500);
  await page.screenshot({ path: `${OUT}/world-2b-whole.png` });
  await page.evaluate(() => document.querySelector('button[aria-label="Back to where you are"]')?.click());
  await wait(1500);
  // Walk at a building from the street, beside its door: stopped at the wall
  const fronts = JSON.parse(await attr("data-fronts"));
  const [fx, fz] = fronts.manga;
  const sideways = Math.abs(fx) > Math.abs(fz) ? [0, 4.7] : [4.7, 0]; // along the street, past its open front, not into it
  const spot = { x: fx + sideways[0], z: fz + sideways[1] };
  await tap({ tap: "ground", ...spot });
  await until(async () => { const [x, z] = await where(); return Math.hypot(x - spot.x, z - spot.z) < 0.5; }, 20000);
  // Turn to face the building (left and right turn, as on the map), then walk at it
  const into = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
  const want = Math.atan2(into[0], into[1]);
  for (let k = 0; k < 60; k++) {
    const heading = Number(await attr("data-heading"));
    const off = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
    if (Math.abs(off) < 0.15) break;
    const key = off > 0 ? "ArrowLeft" : "ArrowRight";
    await page.keyboard.down(key);
    await wait(Math.min(250, Math.max(40, (Math.abs(off) / 2.6) * 1000 * 0.6)));
    await page.keyboard.up(key);
    await wait(300);
  }
  const before = await where();
  await page.keyboard.down("ArrowUp");
  await wait(1500);
  await page.keyboard.up("ArrowUp");
  const after = await where();
  check("a wall stops the hunter (only the door lets them in)", Math.hypot(after[0] - before[0], after[1] - before[1]) < 1.2 && !(await inside()), `${before.map((v) => v.toFixed(1))} → ${after.map((v) => v.toFixed(1))}`);

  // 3. Walking into the fountain house (a trap): its challenge; dodged
  await tap({ tap: "room", id: "fountain" });
  const trap = await page.waitForSelector('[aria-label="Dodge the trap"]', { timeout: 25000 }).then(() => true, () => false);
  check("walking into a wrong house: its trap springs", !!trap, await say());
  await page.screenshot({ path: `${OUT}/world-3-trap.png` });
  if (trap) {
    const dodgeAnswer = (await admin.from("hunt_players").select("house_dodge").eq("hunt_id", huntId).eq("user_id", id).single()).data?.house_dodge?.answer;
    await page.evaluate((k) => document.querySelectorAll('[aria-label="Dodge the trap"] .grid button')[Number(k) - 1]?.click(), dodgeAnswer);
    const dodged = await until(async () => /dodged it/.test(await say()) && (await say()), 10000);
    check("…dodged: out again", !!dodged, dodged ?? (await say()));
  }

  // 4. The comic book stall: empty
  await tap({ tap: "room", id: "manga" });
  const empty = await until(async () => /It's empty/.test(await say()) && (await say()), 25000);
  check("walking into an innocent house: empty, just nothing", !!empty, empty ?? (await say()));

  // 5. The boxes: each in a small house of its own, walked into; its lock opens as the hunter walks up
  const boxes = JSON.parse((await attr("data-boxes")) ?? "{}");
  check("four locked boxes in the town", ["2", "3", "4", "5"].every((n) => boxes[n]) && !boxes["1"], Object.keys(boxes).join(","));
  const houses = [];
  for (const n of [2, 3, 4, 5]) {
    await tap({ tap: "inner", id: String(n) });
    const open = await until(() => page.evaluate((k) => !!document.querySelector(`[data-room-puzzle="${k}"]`), n), 30000);
    houses.push(open ? await attr("data-home") : null);
    if (n === 2) {
      await wait(800);
      await page.screenshot({ path: `${OUT}/world-4-house-box.png` });
    }
    await page.evaluate(() => document.querySelector('[aria-label="Close the puzzle"]')?.click());
    await wait(300);
  }
  check("…each in a small house of its own, walked into (its lock opens at the box)", houses.every((h) => h !== null && Number(h) >= 0) && new Set(houses).size === 4, houses.join(", "));
  const said = await say();
  check("…and the house says so", /locked box|The box is locked/.test(said), said);

  // 6. The noodle stall: the key's chest; walked up to, its puzzle; solved, the key
  await tap({ tap: "room", id: "noodles" });
  const rooms = await until(async () => /key's chest/.test(await say()) && (await say()), 25000);
  check("walking into the right house: the key's chest, locked", !!rooms, rooms ?? (await say()));
  const hot = await until(async () => ((await detector())?.heat === "hot" ? await detector() : null), 10000);
  check("…the detector: hot here, the key's place", !!hot && hot.at === "noodles", JSON.stringify(await detector()));
  // In the hunter's hand, its head glowing hot (owner, 4 Nov 2026: "is the metal detector not suppose to be in his hand")
  const wand = await until(async () => ((await attr("data-wand")) === "hot" ? "hot" : null), 5000);
  check("…held in the hunter's hand, its head glowing hot", wand === "hot", String(await attr("data-wand")));
  // …and beeping, fast, right at the key's place (owner, 4 Nov 2026: "The metal should beep if a tresure in near")
  const beeps0 = await page.evaluate(() => (window.__lootaCues ?? []).filter((c) => c === "beep").length);
  await wait(2000);
  const beeps = (await page.evaluate(() => (window.__lootaCues ?? []).filter((c) => c === "beep").length)) - beeps0;
  check("…beeping fast at the key's place", beeps >= 6, `${beeps} beeps in 2 s, ${await attr("data-beep")} m away`);
  await wait(1200);
  await page.screenshot({ path: `${OUT}/world-5-key-chest.png` });
  const keyRoom = 1;
  // Walked up to: the action button opens it (owner, 5 Nov 2026: "we should have a action button, like enter key")
  const chestAt = JSON.parse((await attr("data-boxes")) ?? "{}")["1"];
  await tap({ tap: "ground", x: chestAt.x, z: chestAt.z });
  const act = await until(() => page.evaluate(() => document.querySelector('[data-action="box"]')?.textContent ?? null), 15000);
  check("at the chest: the action button", /Open the key's chest/.test(act ?? ""), act ?? "none");
  await page.keyboard.press("Enter");
  const sheet = await until(() => page.evaluate((k) => !!document.querySelector(`[data-room-puzzle="${k}"]`), keyRoom), 15000);
  check("at the key's chest: its puzzle opens", !!sheet);
  const dark = await page.evaluate(() => document.querySelector("[data-room-puzzle] [data-dark]")?.getAttribute("data-dark"));
  check("…dark in there without a torch (the board dimmed)", dark === "true", String(dark));
  // Quiet while the puzzle is being done (owner, 8 Nov 2026: "when user is doing the puzzle, the beeping from the metal
  // detector should stop"), though the hunter stands right at the key's place.
  const quiet0 = await page.evaluate(() => (window.__lootaCues ?? []).filter((c) => c === "beep").length);
  await wait(2500);
  const quiet = (await page.evaluate(() => (window.__lootaCues ?? []).filter((c) => c === "beep").length)) - quiet0;
  check("…and the detector quiet while the puzzle is open", quiet === 0, `${quiet} beeps in 2.5 s`);
  const stored = (await admin.from("house_room_puzzles").select("kind, solution").eq("user_id", id).eq("hunt_id", huntId).eq("room", keyRoom).single()).data;
  const answer = stored.kind === "sentries" ? stored.solution.map((col, row) => [row, col]) : stored.solution;
  await page.evaluate((a) => window.__lootaRoomSolve?.(a), answer);
  const card = await until(async () => /Lock 1 of 3/.test(await say()), 20000);
  const held = (await admin.from("hunt_players").select("keys_held").eq("hunt_id", huntId).eq("user_id", id).single()).data.keys_held;
  check("solved: the first of three locks (no key yet)", !!card && held === 0, `${await say()}; keys_held ${held}`);
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
