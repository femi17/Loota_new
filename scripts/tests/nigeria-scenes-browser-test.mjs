// The Nigerian landmarks in the key's world (owner, 7 Nov 2026: "Create another lifetime hunt focused on only Nigeria
// locations"): for each key of the lifetime Nigeria hunt, a throwaway one-key hunt with that key's place, a phone at the
// spot: the key's world opens, draws, and a picture is kept (keyworld-ng-<n>.png). The hunts and test player are deleted.
//   SHOTS=<folder> node scripts/tests/nigeria-scenes-browser-test.mjs
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
const NIGERIA = "45ce2919-ed8d-4930-ae3c-24baf0fde5a1";
let id = null, browser;
const hunts = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const work = { keys: 1, writer: "test", designs: {}, decoys: {}, map: {}, spent: {}, done: true, log: [], skeleton: { title: "Scenes", logline: "x", villain: { name: "x", motive: "x" }, heroes: [], worldRules: [], chapters: [], keys: [] }, chapters: {} };
const SCENE = `[aria-label="The key's place"]`;

try {
  const { data: keys } = await admin.from("hunt_keys").select("n, spot_lng, spot_lat, house").eq("hunt_id", NIGERIA).order("n");
  const email = `ngscenes-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  for (const k of keys) {
    await admin.from("player_positions").upsert({ user_id: id, lng: k.spot_lng, lat: k.spot_lat, mode: "walk", energy: 100, updated_at: ago(30) });
    const { data: hunt, error } = await admin.from("hunts").insert({ title: `Nigeria scene ${k.n} (automated)`, prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true, story: work, story_status: "ready" }).select("id").single();
    if (error) throw error;
    hunts.push(hunt.id);
    await admin.from("hunt_keys").insert({ hunt_id: hunt.id, n: 1, riddle: "Where?", category: "general", trial_kind: "puzzle", area_lng: k.spot_lng, area_lat: k.spot_lat, area_radius_m: 1500, spot_lng: k.spot_lng, spot_lat: k.spot_lat, exact_m: 300, house: k.house });
    await admin.from("hunt_players").insert({ hunt_id: hunt.id, user_id: id });
    const page = await (await browser.createBrowserContext()).newPage();
    await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" });
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
    await page.goto(`http://localhost:3000/play?hunt=${hunt.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
    await until(() => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Explore the place"))), 60000);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Explore the place"))?.click());
    const opened = await until(() => page.evaluate((sel) => !!document.querySelector(sel)?.getAttribute("data-at"), SCENE), 30000);
    await wait(2500);
    await page.screenshot({ path: `${OUT}/keyworld-ng-${k.n}.png` });
    check(`key ${k.n} (${k.house.scene.pieces.join(", ")} on ${k.house.scene.ground}): the key's world opens and draws`, !!opened && problems.length === 0, problems.join(" / "));
    await page.close();
  }
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const h of hunts) await admin.from("hunts").delete().eq("id", h);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunts and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
