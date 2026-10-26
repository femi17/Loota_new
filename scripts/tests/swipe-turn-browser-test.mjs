// Swiping to turn on a phone (owner, 26 Oct 2026: "On mobile we should be able to swipe left and right to make turns").
// A walker mid-street in Yaba, with real touch swipes: sideways in the upper part of the map turns (Right; the same way
// again cancels; Left), as it does in the lower part (Right); a swipe never asks for directions. The test player is
// deleted.
//   SHOTS=<folder> node scripts/tests/swipe-turn-browser-test.mjs
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
const home = { lng: 3.3787, lat: 6.5186 }; // Club Rd, Yaba

try {
  const email = `swipe-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

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
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  // Put the live hunt's invitation away, so the upper map is clear.
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
  await wait(500);

  const chip = () => page.evaluate(() => document.querySelector('button[aria-label^="Turning"]')?.getAttribute("aria-label") ?? null);
  /** A finger swipe from (x1, y) to (x2, y), in a few steps. */
  const swipe = async (x1, x2, y) => {
    await page.touchscreen.touchStart(x1, y);
    for (let i = 1; i <= 6; i++) {
      await page.touchscreen.touchMove(x1 + ((x2 - x1) * i) / 6, y);
      await wait(16);
    }
    await page.touchscreen.touchEnd();
    await wait(600);
  };
  const upperY = Math.round(844 * 0.42); // above the steering zone (the lower 45%)
  const lowerY = Math.round(844 * 0.7);

  await swipe(110, 280, upperY);
  check("upper map, swipe right: turning right at the next junction", /Turning right/.test((await chip()) ?? ""), await chip());
  await page.screenshot({ path: `${OUT}/swipe-1-right.png` });
  await swipe(110, 280, upperY);
  check("…the same way again: cancelled", (await chip()) === null, await chip());
  await swipe(280, 110, upperY);
  check("upper map, swipe left: turning left", /Turning left/.test((await chip()) ?? ""), await chip());
  await swipe(280, 110, upperY); // cancel
  await swipe(110, 280, lowerY);
  check("lower part, swipe right: turning right (as before)", /Turning right/.test((await chip()) ?? ""), await chip());
  const directions = await page.evaluate(() => !!document.querySelector('[aria-label="Directions"]') || /Finding a route|To the marked spot/.test(document.body.innerText));
  check("a swipe never asks for directions", !directions);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
