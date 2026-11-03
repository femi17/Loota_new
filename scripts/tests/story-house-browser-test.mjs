// Every story key is a house (owner, 1 Nov 2026: "there shouldn't be open chest… we already agreed it is a house 3d").
// "Twelve Sharp"'s Key 1 house (Aunty Ìyábọ̀'s dye house at Olumo Rock), copied into a test hunt, on a phone:
//   1. at the place: "🧭 Explore the place" (the key's quarter), and no chest rising out in the open;
//   2. the house: its name and its three rooms;
//   3. the plot the story points to (her indigo): walked onto, dug, and the chest is there;
//   4. the Key Trial runs out: thrown 2 km away, and "Explore the place" is gone (owner, 1 Nov 2026).
// The hunt and test player are deleted.   SHOTS=<folder> node scripts/tests/story-house-browser-test.mjs
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
const work = { keys: 1, writer: "test", designs: {}, decoys: {}, map: {}, spent: {}, done: true, log: [], skeleton: { title: "House test", logline: "x", villain: { name: "x", motive: "x" }, heroes: [], worldRules: [], chapters: [], keys: [] }, chapters: {} };

try {
  const { data: k1 } = await admin.from("hunt_keys").select("spot_lng, spot_lat, house").eq("hunt_id", "45b94806-a16a-4e88-8eae-7337474a71f3").eq("n", 1).single();
  const PLACE = { lng: k1.spot_lng, lat: k1.spot_lat };
  const email = `storyhouse-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Story house test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true, story: work, story_status: "ready" }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where did Aunty Ìyábọ̀ keep card one?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng, area_lat: PLACE.lat, area_radius_m: 1500, spot_lng: PLACE.lng, spot_lat: PLACE.lat, exact_m: 120, house: k1.house });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
  const buttonText = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent ?? "").join(" | "));
  const say = () => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "");

  // 1. At the place
  const go = await until(async () => (await buttonText()).includes("Explore the place"), 60000);
  await wait(2000);
  check("at the place: Explore the place, and no Open the chest", !!go && !/Open the chest/.test(await buttonText()));
  await page.screenshot({ path: `${OUT}/story-house-0-map.png` });

  // 2. The house
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Explore the place"))?.click());
  const inside = await until(() => page.evaluate(() => !!document.querySelector('[aria-label="The key\'s place"] canvas') && document.body.innerText.includes("Aunty Ìyábọ̀'s dye house")));
  check("the quarter opens: Aunty Ìyábọ̀'s dye house", !!inside);
  await wait(1500);
  await page.screenshot({ path: `${OUT}/story-house-1-inside.png` });

  // 3. The indigo room
  await until(() => page.evaluate(() => document.querySelector('[aria-label="The key\'s place"]')?.getAttribute("data-busy") === "false"), 20000);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: { tap: "room", id: "indigo" } })));
  const chest = await until(async () => /Five rooms/.test(await say()) && (await say()), 25000);
  check("the indigo building (the story's \"at her indigo\"): walked into, its five rooms", !!chest, chest ?? (await say()));
  await wait(800);
  await page.screenshot({ path: `${OUT}/story-house-2-indigo.png` });

  // (Thrown away from the place: thrown-away-browser-test.mjs. The rooms: hunt-city-browser-test.mjs.)
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
