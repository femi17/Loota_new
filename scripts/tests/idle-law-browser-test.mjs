// The idling law (owner, 12 Nov 2026: "if user knows, they want to be idle, they need to be at a relex joint. If a user
// stays on the major road for 1hr+ either by standing or in any vehicle but not moving. The person should be locked in a
// cell, and then their vehicle impounded"). A player on their motorbike, standing on a main road in Surulere:
//   1. their game tells the server they're on a main road;
//   2. 50 minutes still there: an officer's warning;
//   3. 65 minutes: locked in a cell (the card, 30 minutes on its clock), the motorbike impounded, on foot;
//   4. in the cell they can't move (the server refuses it);
//   5. bail (150): out at once; the pound's button; released (200): the motorbike theirs again.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/idle-law-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 500) { const v = await fn(); if (v) return v; await wait(500); } return null; };
const start = { lng: 3.3620, lat: 6.4975 }; // Western Avenue, Surulere (a primary road)

try {
  const email = `idlelaw-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), coins: 1000, rider_licence: true }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  const { data: bike } = await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true }).select("id").single();
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [...jar].map(([n, value]) => ({ name: n, value })), setAll: (l) => l.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((u) => { try { localStorage.setItem(`loota:welcome:${u}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const pos = async () => (await admin.from("player_positions").select("lng, lat, mode, on_main_road, still_since").eq("user_id", id).single()).data;
  const text = () => page.evaluate(() => document.body.innerText).catch(() => "");

  // 1. On a main road, as their game sees it, told to the server
  const main = await until(async () => (await page.evaluate(() => window.__lootaMainRoad?.() ?? null).catch(() => null)) === true, 60000);
  const told = await until(async () => (await pos())?.on_main_road === true, 15000);
  check("1. on a main road (their game), and the server told", !!main && !!told, JSON.stringify(await pos()));
  if (!main) console.log("  (their game:", JSON.stringify(await page.evaluate(() => ({ cls: window.__lootaRoadClass?.(), main: window.__lootaMainRoad?.(), at: window.__lootaPos?.() })).catch((e) => String(e))), (await text()).slice(0, 300).split("\n").join(" | "), ")");
  await wait(3000);

  // 2. 50 minutes still: the officer's warning
  await admin.from("player_positions").update({ still_since: ago(50 * 60) }).eq("user_id", id);
  await page.evaluate(() => window.__lootaLaw?.());
  const warned = await until(async () => /An officer/.test(await text()), 15000);
  check("2. 50 minutes still on it: an officer's warning", !!warned, (await text()).match(/👮[^\n]*/)?.[0]?.slice(0, 160));

  // 3. 65 minutes: the cell, the motorbike impounded
  await admin.from("player_positions").update({ still_since: ago(65 * 60) }).eq("user_id", id);
  await page.evaluate(() => window.__lootaLaw?.());
  const jailed = await until(() => page.evaluate(() => !!document.querySelector("[data-jail]")), 15000);
  const left = Number(await page.evaluate(() => document.querySelector("[data-jail-left]")?.getAttribute("data-jail-left")));
  const v1 = (await admin.from("player_vehicles").select("in_use, impounded_at").eq("id", bike.id).single()).data;
  const p1 = await pos();
  check("3. 65 minutes: locked in a cell (30 minutes on its clock)", !!jailed && left > 1780 && left <= 1800, `${left} s left`);
  check("…the motorbike impounded, and on foot", !!v1.impounded_at && !v1.in_use && p1.mode === "walk", JSON.stringify({ v1, mode: p1.mode }));
  await page.screenshot({ path: `${OUT}/idle-law-1-cell.png` });

  // 4. In the cell: no moving
  const { data: tried } = await c.rpc("save_position", { p_lng: p1.lng + 0.0004, p_lat: p1.lat, p_mode: "walk" });
  check("4. in the cell they can't move (the server refuses it)", tried?.ok === false && tried.reason === "jailed", JSON.stringify(tried));

  // 5. Bail, then the pound
  await page.evaluate(() => document.querySelector("[data-bail]")?.click());
  const out = await until(() => page.evaluate(() => !document.querySelector("[data-jail]")), 15000);
  const pound = await until(() => page.evaluate(() => !!document.querySelector('[data-pound="motorbike"]')), 15000);
  check("5. bail paid: out at once, and the pound's button for the motorbike", !!out && !!pound, JSON.stringify(await page.evaluate(() => ({ jail: !!document.querySelector("[data-jail]"), pound: [...document.querySelectorAll("[data-pound]")].length, says: [...document.querySelectorAll("[role=status], [aria-live]")].map((e) => e.textContent).join(" | ").slice(0, 300) }))));
  await page.screenshot({ path: `${OUT}/idle-law-2-pound.png` });
  await page.evaluate(() => document.querySelector('[data-pound="motorbike"]')?.click());
  const freed = await until(async () => (await admin.from("player_vehicles").select("impounded_at").eq("id", bike.id).single()).data.impounded_at === null, 15000);
  const coins = (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const gone = await until(() => page.evaluate(() => !document.querySelector("[data-pound]")), 10000);
  check("…released from the pound: theirs again (1000 − 150 bail − 200 fee)", !!freed && Number(coins) === 650 && !!gone, `${coins} coins`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("idle_arrests").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.from("player_positions").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
