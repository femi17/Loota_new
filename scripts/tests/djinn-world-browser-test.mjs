// The Djinn's world (owner, 12 Nov 2026: "when I got to taj marha… nothing happened. IT should at least tell me, if it was
// the right location or wrong… we make it like the key location… Let it have 3 puzzles to solve"). A test player in the
// live Wager, having chosen a FALSE seal (so the live Wonder is never touched), standing ~150 m from it in free roam:
//   1. "Explore the place" shows within 300 m, and opens the Djinn's ground (its own 3D town);
//   2. the last lock can't be opened first;
//   3. a trapped place: the dodge challenge; dodged;
//   4. the vault's place: its first lock; solved, "Lock 1 of 3", the second lock lit; solved, the last lock;
//   5. the last lock: the vault is EMPTY, said as a false place; the world closes; the map says so; the entry is fooled.
// The player and their Djinn rows are deleted.   node scripts/tests/djinn-world-browser-test.mjs
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
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
let id = null, wagerId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
const md5 = (s) => createHash("md5").update(s).digest("hex");

try {
  const { data: w } = await admin.from("djinn_wagers").select("id, site_ids, real_site, winner, ends_at").lte("starts_at", new Date().toISOString()).gt("ends_at", new Date().toISOString()).is("winner", null).order("starts_at", { ascending: false }).limit(1).single();
  if (!w) throw new Error("No open Wager to test in");
  wagerId = w.id;
  const fake = w.site_ids.map(Number).find((s) => s !== Number(w.real_site));
  const { data: site } = await admin.from("djinn_sites").select("*").eq("id", fake).single();
  const email = `djinnworld-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: site.lng + 0.01, home_lat: site.lat, home_set_at: new Date().toISOString(), coins: 500, torch: true }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: site.lng + 0.0016, lat: site.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { error: eErr } = await admin.from("djinn_entries").insert({ wager_id: wagerId, user_id: id, gate_score: 3, favour: 3, chosen_site: fake, chosen_at: new Date().toISOString() });
  if (eErr) throw eErr;
  // Which place is the vault and which are traps (as the server works it out: its own for each player and Wager)
  const order = ["p1", "p2", "p3", "p4", "p5", "p6"].sort((a, b) => (md5(`${id}:${wagerId}:${a}`) < md5(`${id}:${wagerId}:${b}`) ? -1 : 1));
  const vault = order[0], trap = order[1];

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [...jar].map(([n, value]) => ({ name: n, value })), setAll: (l) => l.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((u, wid) => { try { localStorage.setItem(`loota:welcome:${u}`, "1"); localStorage.setItem(`loota:djinn-seen:${wid}`, "1"); } catch {} }, id, wagerId);
  await page.goto(`http://localhost:3000/play`, { waitUntil: "domcontentloaded", timeout: 120000 });

  // 1. The button within 300 m, and the world
  const btn = await until(() => page.evaluate(() => !!document.querySelector("[data-djinn-explore]")), 90000);
  check("1. 'Explore the place' shows ~140 m from the chosen place", !!btn);
  await page.evaluate(() => document.querySelector("[data-djinn-explore]")?.click());
  const SCENE = '[aria-label="The Djinn\'s ground"]';
  const opened = await until(() => page.evaluate((s) => !!document.querySelector(s), SCENE), 30000);
  await until(() => page.evaluate((s) => document.querySelector(s)?.getAttribute("data-at"), SCENE), 30000);
  const head = await page.evaluate((s) => document.querySelector(`${s} [data-house-head]`)?.textContent ?? "", SCENE);
  check("…it opens the Djinn's ground (its own town)", !!opened && /Djinn's Wager/.test(head) && head.includes(site.name), head.slice(0, 90));
  await page.screenshot({ path: `${OUT}/djinn-world-1.png` });
  const attr = (n) => page.evaluate((sel, k) => document.querySelector(sel)?.getAttribute(k), SCENE, n).catch(() => null);
  const idle = () => until(async () => (await attr("data-busy")) === "false", 20000);
  const say = () => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "").catch(() => "");
  const tap = async (detail) => {
    await idle();
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
    await wait(300);
  };
  const boxes = async () => JSON.parse((await attr("data-boxes")) ?? "{}");

  // 2. The last lock first
  const early = await page.evaluate(async () => (await fetch("/api/djinn/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room: 7 }) })).json());
  check("2. the last lock can't be opened first", early?.ok === false && early.reason === "chain", JSON.stringify(early));

  // 3. A trapped place: the challenge, dodged
  await tap({ tap: "room", id: trap });
  const dodge = await until(() => page.evaluate(() => !!document.querySelector('[aria-label="Dodge the trap"]')), 30000);
  const right = (await admin.from("djinn_worlds").select("dodge").eq("user_id", id).eq("wager_id", wagerId).single()).data?.dodge?.answer;
  await page.evaluate((k) => document.querySelectorAll('[aria-label="Dodge the trap"] .grid button')[k - 1]?.click(), Number(right));
  const dodged = await until(async () => /You dodged it/.test(await say()), 10000);
  check("3. a trapped place springs its challenge; answered in time, dodged", !!dodge && !!dodged, await say());
  await wait(3500); // out a moment after a dodge

  /** Answers the open puzzle of room `n` as its board would hand it in. */
  const kinds = [];
  async function solve(n) {
    const { data: row } = await admin.from("djinn_world_puzzles").select("kind, solution").eq("user_id", id).eq("wager_id", wagerId).eq("room", n).single();
    kinds.push(row.kind);
    await wait(600);
    await page.evaluate((a) => window.__lootaRoomSolve?.(a), row.solution);
    return until(() => page.evaluate((r) => !document.querySelector(`[data-room-puzzle="${r}"]`), n).catch(() => false), 20000);
  }

  // 4. The vault's place, its three locks
  await tap({ tap: "room", id: vault });
  const found = await until(async () => /the Djinn's vault!/.test(await say()), 30000);
  check("4. into the vault's place: 'the Djinn's vault', its first lock", !!found, await say());
  const chestAt = await until(async () => (await boxes())["1"], 20000);
  await tap({ tap: "ground", x: chestAt.x, z: chestAt.z });
  await until(() => page.evaluate(() => !!document.querySelector('[data-action="box"]')), 20000);
  await page.keyboard.press("Enter");
  await until(() => page.evaluate(() => !!document.querySelector('[data-room-puzzle="1"]')), 20000);
  await solve(1);
  const l1 = await until(async () => /Lock 1 of 3/.test(await say()), 15000);
  const lit2 = await until(async () => ((await boxes())["6"] && (await attr("data-guide")) === "6" ? true : null), 10000);
  check("…solved: 'Lock 1 of 3', the second lock lit", !!l1 && !!lit2, await say());
  await tap({ tap: "inner", id: "6" });
  await until(() => page.evaluate(() => !!document.querySelector('[data-room-puzzle="6"]')), 40000);
  await solve(6);
  const l2 = await until(async () => /Lock 2 of 3/.test(await say()), 15000);
  check("…the second lock: 'Lock 2 of 3'", !!l2, await say());

  // 5. The last lock: an empty vault (a false place), said; the world closes
  await tap({ tap: "inner", id: "7" });
  await until(() => page.evaluate(() => !!document.querySelector('[data-room-puzzle="7"]')), 40000);
  await solve(7);
  const empty = await until(async () => { const t = await say(); return /vault is empty/.test(t) && t; }, 15000);
  check("5. the last lock: the vault is empty, a false place (said)", !!empty, await say());
  await page.screenshot({ path: `${OUT}/djinn-world-2-empty.png` });
  const closed = await until(() => page.evaluate((s) => !document.querySelector(s), SCENE), 15000);
  const mapSaid = await until(() => page.evaluate(() => /false place/.test(document.body.innerText)), 8000);
  check("…the world closes and the map says it was a false place", !!closed && !!mapSaid);
  const entry = (await admin.from("djinn_entries").select("vault").eq("user_id", id).eq("wager_id", wagerId).single()).data;
  const still = (await admin.from("djinn_wagers").select("winner").eq("id", wagerId).single()).data;
  check("…the entry is marked fooled (vault empty), the Wager untouched", entry?.vault === "empty" && still?.winner === null, JSON.stringify({ entry, still }));
  check("the three locks: three different puzzles", new Set(kinds).size === 3, kinds.join(", "));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("djinn_world_puzzles").delete().eq("user_id", id);
    await admin.from("djinn_worlds").delete().eq("user_id", id);
    await admin.from("djinn_entries").delete().eq("user_id", id);
    await admin.from("player_positions").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
