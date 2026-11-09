// The key's chest's puzzle, solved through its board as a hunter does (owner, 9 Nov 2026: "verify the questions in the
// key location actually have an asnwer. I solved one and it said all the answers are wrong, same happened with the
// english too yesterday"). The kind a box gets is dealt by the hunt, the key and the box, so each round makes a hunt
// whose key's chest has the kind wanted (at the 4th key: the hardest, as the owner's algebra; or the 1st), and a hunter
// who walks into the right house, up to the chest, and answers its puzzle on the board, tapping and typing the right
// answers (from the database), then "Check": it must open (the key). The algebra round first gets one answer wrong:
// "Not quite", and the other answers stay (they used to be wiped); that one put right, it opens. Each hunt and player is
// deleted.   [ONLY=algebra,grammar] node scripts/tests/box-puzzles-ui-browser-test.mjs
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let browser;
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

// As src/lib/house-rooms.ts deals them (kept the same)
const ROOM_KINDS = ["grammar", "algebra", "countries", "flags", "brands", "vowels", "route", "threads", "sudoku"];
function roomSeed(uid, hunt, key, room, attempt = 0) {
  let n = 2166136261;
  for (const ch of `${uid}:${hunt}:${key}:${room}${attempt ? `:${attempt}` : ""}`) n = Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0;
  return n % 2147483646 || 1;
}
const roomLevel = (key) => (key >= 3 ? 3 : 2);
const kindsAt = (key) => (roomLevel(key) >= 3 ? ROOM_KINDS.filter((k) => k !== "flags" && k !== "brands") : ROOM_KINDS);
function roomKind(hunt, key, room) {
  let n = roomSeed("", hunt, key, room) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b) >>> 0;
  const kinds = kindsAt(key);
  const k = kinds[n % kinds.length];
  return key > 1 && k === roomKind(hunt, key - 1, room) ? kinds[(kinds.indexOf(k) + 1) % kinds.length] : k;
}
/** A hunt id whose key's chest (box 1) at `key` has `kind`. */
function huntFor(kind, key) {
  for (;;) {
    const id = randomUUID();
    if (roomKind(id, key, 1) === kind) return id;
  }
}

const ROUNDS = [
  ["algebra", 4], ["grammar", 4], ["vowels", 4], ["sudoku", 4], ["countries", 4],
  ["grammar", 1], ["flags", 1], ["brands", 1], ["algebra", 1],
].filter(([k]) => !process.env.ONLY || process.env.ONLY.split(",").includes(k));

const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };

async function round(kind, key) {
  const huntId = huntFor(kind, key);
  let uid = null;
  let context = null;
  try {
    const { error } = await admin.from("hunts").insert({ id: huntId, title: "Key chest puzzles UI test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true });
    if (error) throw error;
    // The keys before this one far away; this one here, its house
    for (let n = 1; n <= key + 1; n++) {
      const here = n === key;
      await admin.from("hunt_keys").insert({ hunt_id: huntId, n, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng + (here ? 0 : 0.05 * n), area_lat: PLACE.lat, area_radius_m: 1500,
        spot_lng: PLACE.lng + (here ? 0 : 0.05 * n), spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
    }
    const email = `chestui-${kind}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    uid = data.user.id;
    await admin.from("profiles").update({ home_lng: 139.69, home_lat: 35.66, home_set_at: new Date().toISOString(), coins: 500, torch: true }).eq("id", uid);
    await admin.from("player_positions").upsert({ user_id: uid, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
    await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: uid, keys_held: key - 1, guess_n: key, guess_name: "The place", guess_lng: PLACE.lng, guess_lat: PLACE.lat, leg_lng: PLACE.lng, leg_lat: PLACE.lat });
    const jar = new Map();
    const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
    await c.auth.signInWithPassword({ email, password });
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((hh, u) => { try { localStorage.setItem(`loota:riddle-seen:${hh}`, "1"); localStorage.setItem(`loota:welcome:${u}`, "1"); localStorage.setItem(`loota:story:${hh}:start`, "1"); } catch {} }, huntId, uid);
    await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const SCENE = '[aria-label="The key\'s place"]';
    const attr = (n) => page.evaluate((sel, k) => document.querySelector(sel)?.getAttribute(k), SCENE, n);
    const idle = () => until(async () => (await attr("data-busy")) === "false", 20000);
    const say = () => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "");
    const tap = async (detail) => {
      await idle();
      await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
      await wait(300);
    };
    await until(() => page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Explore the place/.test(x.textContent ?? "")); b?.click(); return !!b; }), 90000);
    await until(async () => (await attr("data-at")) != null, 30000);
    // Into the right house, up to the key's chest, and open it
    await tap({ tap: "room", id: "noodles" });
    await until(async () => /key's chest/.test(await say()), 30000);
    const chestAt = await until(async () => JSON.parse((await attr("data-boxes")) ?? "{}")["1"], 20000);
    if (!chestAt) return check(`${kind} at key ${key}: the key's chest is there`, false);
    await tap({ tap: "ground", x: chestAt.x, z: chestAt.z });
    await until(() => page.evaluate(() => !!document.querySelector('[data-action="box"]')), 20000);
    await page.keyboard.press("Enter");
    const B = '[data-room-puzzle="1"]';
    const open = await until(() => page.evaluate((s) => !!document.querySelector(s), B), 20000);
    const { data: row } = await admin.from("house_room_puzzles").select("kind, puzzle, solution").eq("user_id", uid).eq("hunt_id", huntId).eq("room", 1).maybeSingle();
    const label = `${kind} at key ${key} (level ${roomLevel(key)})`;
    if (!open || row?.kind !== kind) return check(`${label}: the key's chest's puzzle opens`, false, `opened ${!!open}, kind ${row?.kind}`);
    const sol = row.solution;
    await wait(600);
    const putIn = async (answers) => {
      if (kind === "grammar" || kind === "flags" || kind === "brands") {
        await page.evaluate((s, picks) => [...document.querySelectorAll(`${s} [data-question]`)].forEach((q, i) => q.querySelectorAll("button")[picks[i]]?.click()), B, answers);
      } else if (kind === "algebra" || kind === "vowels" || kind === "countries") {
        const inputs = await page.$$(`${B} input`);
        for (let i = 0; i < inputs.length; i++) {
          // Emptied as a hunter would (to its end, then back over what's there), then typed
          const had = await inputs[i].evaluate((el) => el.value.length);
          await inputs[i].click();
          await page.keyboard.press("End");
          for (let k = 0; k < had; k++) await page.keyboard.press("Backspace");
          await inputs[i].type(String(answers[i]));
        }
      } else if (kind === "sudoku") {
        const empty = await page.evaluate((s) => [...document.querySelectorAll(`${s} [data-cell]`)].filter((b) => /empty$/.test(b.getAttribute("aria-label") ?? "")).map((b) => Number(b.getAttribute("data-cell"))), B);
        for (const i of empty) {
          await page.evaluate((s, k) => document.querySelector(`${s} [data-cell="${k}"]`)?.click(), B, i);
          await page.evaluate((s, d) => document.querySelector(`${s} [aria-label="Number ${d}"]`)?.click(), B, answers[i]);
        }
      }
      await wait(400);
    };
    const pressCheck = () => page.evaluate((s) => { const b = [...document.querySelectorAll(`${s} button`)].find((x) => /Check.*✓/.test(x.textContent ?? "") && !x.disabled); b?.click(); return b ? b.textContent : [...document.querySelectorAll(`${s} button`)].find((x) => /check|named|filled/i.test(x.textContent ?? ""))?.textContent ?? "(no Check button)"; }, B);
    const outcome = () => until(async () => {
      const st = await page.evaluate((s) => ({ open: !!document.querySelector(s), note: document.querySelector(s)?.innerText.match(/Not quite[^\n]*/)?.[0] ?? null }), B);
      if (st.note) return { right: false, note: st.note };
      if (!st.open) return { right: true, said: await say() };
      return null;
    }, 20000);
    const typed = () => page.evaluate((s) => [...document.querySelectorAll(`${s} input`)].map((i) => i.value), B);

    if (kind === "algebra") {
      // One wrong first: "Not quite", and the others stay
      const wrong = [Number(sol[0]) + 1, ...sol.slice(1)];
      await putIn(wrong);
      await pressCheck();
      const first = await outcome();
      const kept = await typed();
      check(`${label}: one answer wrong → "Not quite", how many are right, and the other answers stay`, first && !first.right && new RegExp(`${sol.length - 1} of ${sol.length} are right`).test(first.note) && kept.slice(1).join(",") === sol.slice(1).map(String).join(","), `${first?.note ?? JSON.stringify(first)}; still in the boxes: ${kept.join(", ")}`);
    }
    await putIn(sol);
    const pressed = await pressCheck();
    const end = await outcome();
    check(`${label}: answered right on its board → the chest opens`, !!end?.right, end ? (end.right ? end.said.slice(0, 60) : `${end.note}; answers ${JSON.stringify(sol).slice(0, 80)}`) : `no answer from the chest; the button said "${pressed}"`);
    check(`${label}: no page errors`, problems.length === 0, problems.join(" / "));
  } finally {
    await context?.close().catch(() => {});
    await admin.from("house_room_puzzles").delete().eq("hunt_id", huntId);
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_events").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
    if (uid) {
      await admin.from("hunter_scenes").delete().eq("user_id", uid);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.log(`(couldn't delete test player ${uid}: ${error.message})`);
    }
  }
}

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  for (const [kind, key] of ROUNDS) {
    try {
      await round(kind, key);
    } catch (e) {
      fails++;
      console.log(`ERROR in ${kind} at key ${key}:`, e.message);
    }
  }
} finally {
  await browser?.close();
  console.log(`hunts and test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
