// The key's place: three locks in a chain (owner, 12 Nov 2026: "for key location… Let it have 3 puzzles to solve. 1 is
// too simple and easy. from 1 to another, another to look for the next puzzle to another house, then they key the
// key"). A hunter at Key 1 of a test hunt (Tokyo):
//   1. the third lock can't be opened first (the server refuses it: "won't turn yet");
//   2. into the right house, the key's chest: the first lock; solved, "Lock 1 of 3 opens", no key yet; the second
//      lock shows in another small house, lit with a gold light;
//   3. the second lock: its own puzzle (another kind); solved, "Lock 2 of 3", the third lock shows, lit;
//   4. the third lock: solved, the key (Key 1 held).
// Each lock's puzzle is answered on its board where a script can (options, typed answers, a sudoku), otherwise as its
// board would hand it in. The hunt and the player are deleted.   node scripts/tests/key-chain-browser-test.mjs
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
const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };

try {
  const email = `keychain-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 139.69, home_lat: 35.66, home_set_at: new Date().toISOString(), coins: 500, torch: true }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Key chain test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  for (const n of [1, 2]) {
    await admin.from("hunt_keys").insert({ hunt_id: huntId, n, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng + (n - 1) * 0.05, area_lat: PLACE.lat, area_radius_m: 1500,
      spot_lng: PLACE.lng + (n - 1) * 0.05, spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
  }
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "The place", guess_lng: PLACE.lng, guess_lat: PLACE.lat, leg_lng: PLACE.lng, leg_lat: PLACE.lat });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [...jar].map(([n, value]) => ({ name: n, value })), setAll: (l) => l.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((hh, u) => { try { localStorage.setItem(`loota:riddle-seen:${hh}`, "1"); localStorage.setItem(`loota:welcome:${u}`, "1"); localStorage.setItem(`loota:story:${hh}:start`, "1"); } catch {} }, huntId, id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const SCENE = '[aria-label="The key\'s place"]';
  const attr = (n) => page.evaluate((sel, k) => document.querySelector(sel)?.getAttribute(k), SCENE, n).catch(() => null);
  const idle = () => until(async () => (await attr("data-busy")) === "false", 20000);
  const say = () => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "").catch(() => "");
  const tap = async (detail) => {
    await idle();
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
    await wait(300);
  };
  const boxes = async () => JSON.parse((await attr("data-boxes")) ?? "{}");
  await until(() => page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Explore the place/.test(x.textContent ?? "")); b?.click(); return !!b; }), 90000);
  await until(async () => (await attr("data-at")) != null, 30000);

  // 1. The third lock first: refused by the server
  const early = await page.evaluate(async (h) => (await fetch("/api/house/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hunt: h, room: 7 }) })).json(), huntId);
  check("1. the third lock can't be opened first", early?.ok === false && early.reason === "chain", JSON.stringify(early));
  const hidden = await boxes();
  check("…and the second and third locks don't show yet", !hidden["6"] && !hidden["7"], Object.keys(hidden).join(","));

  /** Answers the open puzzle of room `n`: on its board where a script can, otherwise as its board would hand it in. */
  const kinds = [];
  async function solve(n) {
    const B = `[data-room-puzzle="${n}"]`;
    const { data: row } = await admin.from("house_room_puzzles").select("kind, solution").eq("user_id", id).eq("hunt_id", huntId).eq("room", n).single();
    kinds.push(row.kind);
    const sol = row.solution;
    await wait(600);
    let onBoard = true;
    if (["grammar", "flags", "brands"].includes(row.kind)) {
      await page.evaluate((s, picks) => [...document.querySelectorAll(`${s} [data-question]`)].forEach((q, i) => q.querySelectorAll("button")[picks[i]]?.click()), B, sol);
    } else if (["algebra", "vowels", "countries"].includes(row.kind)) {
      const inputs = await page.$$(`${B} input`);
      for (let i = 0; i < inputs.length; i++) await inputs[i].type(String(sol[i]));
    } else if (row.kind === "sudoku") {
      const empty = await page.evaluate((s) => [...document.querySelectorAll(`${s} [data-cell]`)].filter((b) => /empty$/.test(b.getAttribute("aria-label") ?? "")).map((b) => Number(b.getAttribute("data-cell"))), B);
      for (const i of empty) {
        await page.evaluate((s, k) => document.querySelector(`${s} [data-cell="${k}"]`)?.click(), B, i);
        await page.evaluate((s, d) => document.querySelector(`${s} [aria-label="Number ${d}"]`)?.click(), B, sol[i]);
      }
    } else onBoard = false;
    await wait(400);
    if (process.env.DEBUG) console.log(`  (room ${n}, ${row.kind}: answers ${JSON.stringify(sol).slice(0, 60)}; the board: ${await page.evaluate((s) => [...document.querySelectorAll(`${s} input`)].map((i) => i.value).join(",") + " | " + [...document.querySelectorAll(`${s} button`)].map((b) => b.textContent?.trim() + (b.disabled ? "(off)" : "")).filter((t) => /check|named|filled|find/i.test(t)).join(" / "), B)})`);
    if (onBoard) await page.evaluate((s) => [...document.querySelectorAll(`${s} button`)].find((x) => /Check.*✓/.test(x.textContent ?? "") && !x.disabled)?.click(), B);
    else await page.evaluate((a) => window.__lootaRoomSolve?.(a), sol);
    return until(() => page.evaluate((s) => !document.querySelector(s), B).catch(() => false), 20000);
  }

  // 2. The key's chest: the first lock
  await tap({ tap: "room", id: "noodles" });
  await until(async () => /key's chest/.test(await say()), 30000);
  const chestAt = await until(async () => (await boxes())["1"], 20000);
  await tap({ tap: "ground", x: chestAt.x, z: chestAt.z });
  await until(() => page.evaluate(() => !!document.querySelector('[data-action="box"]')), 20000);
  await page.keyboard.press("Enter");
  await until(() => page.evaluate(() => !!document.querySelector('[data-room-puzzle="1"]')), 20000);
  await solve(1);
  const first = await until(async () => { const t = await say(); return /Lock 1 of 3/.test(t) && t; }, 15000);
  const held1 = (await admin.from("hunt_players").select("keys_held").eq("hunt_id", huntId).eq("user_id", id).single()).data.keys_held;
  const row1 = (await admin.from("house_room_puzzles").select("kind, solved_at, outcome, tries").eq("user_id", id).eq("hunt_id", huntId).eq("room", 1).maybeSingle()).data;
  check("2. the key's chest (lock 1) opens: 'Lock 1 of 3', no key yet", !!first && held1 === 0, `${first ?? `said: ${await say()}; note: ${await page.evaluate(() => document.querySelector("[data-room-puzzle]")?.innerText.slice(0, 120) ?? "(puzzle closed)").catch(() => "")}`}; keys ${held1}; chest row ${JSON.stringify(row1)}`);
  const lit2 = await until(async () => ((await boxes())["6"] && (await attr("data-guide")) === "6" ? true : null), 10000);
  check("…the second lock shows in another house, lit with a gold light", !!lit2, `boxes ${Object.keys(await boxes()).join(",")}, lit ${await attr("data-guide")}`);
  const arrow = await until(() => page.evaluate(() => { const e = document.querySelector("[data-to-lock]"); return e ? { n: e.getAttribute("data-to-lock"), text: e.textContent, turn: e.querySelector("[aria-hidden]")?.style.transform } : null; }).catch(() => null), 8000);
  check("…and an arrow on the screen points the way to it, with the distance", arrow?.n === "6" && /Lock 2 · \d+ m/.test(arrow.text), JSON.stringify(arrow));
  await page.screenshot({ path: `${OUT}/key-chain-1-lit.png` });
  await page.evaluate(() => document.querySelector('button[aria-label="See the whole place"]')?.click());
  await wait(2500);
  await page.screenshot({ path: `${OUT}/key-chain-2-whole.png` });
  await page.evaluate(() => document.querySelector('button[aria-label="Back to where you are"]')?.click());
  await wait(1200);

  // 3. The second lock
  await tap({ tap: "inner", id: "6" });
  const open2 = await until(() => page.evaluate(() => !!document.querySelector('[data-room-puzzle="6"]')), 40000);
  check("3. walked up to the second lock: its puzzle opens", !!open2);
  await solve(6);
  const second = await until(async () => { const t = await say(); return /Lock 2 of 3/.test(t) && t; }, 15000);
  const lit3 = await until(async () => ((await boxes())["7"] && (await attr("data-guide")) === "7" ? true : null), 10000);
  check("…solved: 'Lock 2 of 3', the third lock shows, lit", !!second && !!lit3, `${second}; lit ${await attr("data-guide")}`);

  // 4. The third lock: the key
  await tap({ tap: "inner", id: "7" });
  const open3 = await until(() => page.evaluate(() => !!document.querySelector('[data-room-puzzle="7"]')), 40000);
  check("4. the third lock: its puzzle opens", !!open3);
  await solve(7);
  const third = await until(async () => { const t = await say(); return /the key!/.test(t) && t; }, 15000);
  const held = await until(async () => ((await admin.from("hunt_players").select("keys_held").eq("hunt_id", huntId).eq("user_id", id).single()).data.keys_held === 1 ? true : null), 20000);
  check("…solved: the key (Key 1 held)", !!third && !!held, third ?? (await say()));
  check("the three locks: three different puzzles", new Set(kinds).size === 3, kinds.join(", "));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("house_room_puzzles").delete().eq("hunt_id", huntId);
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_events").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) {
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
