// One device a player (owner, 3 Nov 2026: "If a user joins on 2 device, we close one so it doesn't affect the
// broadcast"): the same player opens the game on a phone, then on a second device: the first closes its game ("Loota
// is open on another device") and the second plays; "Play here instead" on the first takes it back (the second
// closes). Two browser windows that share nothing stand in for the two devices. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/one-device-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `one-device-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  /** A device: its own browser window, signed in on its own. */
  const device = async () => {
    const jar = new Map();
    const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
    await c.auth.signInWithPassword({ email, password });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => {
      try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
    }, id);
    return page;
  };
  const closed = (page) => page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Playing on another device"]'));
  const playing = (page) => page.evaluate(() => !!document.querySelector(".maplibregl-canvas") && !document.querySelector('[aria-label="Playing on another device"]'));
  const until = async (fn, tries = 30) => {
    for (let i = 0; i < tries; i++) {
      if (await fn()) return true;
      await wait(500);
    }
    return false;
  };

  const phone = await device();
  await phone.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  check("the first device plays", await playing(phone));
  const laptop = await device();
  await laptop.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  check("the game opened on a second device: it plays there", await playing(laptop));
  check("…and the first closes its game: 'open on another device'", await until(() => closed(phone)));
  await phone.screenshot({ path: `${OUT}/one-device-1-closed.png` });
  const before = (await admin.from("player_sessions").select("session_id").eq("user_id", id).single()).data?.session_id;
  await phone.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Play here instead/.test(b.textContent ?? ""))?.click());
  check("'Play here instead' on the first: it plays again", await until(() => playing(phone), 40));
  check("…and the second closes", await until(() => closed(laptop)));
  const after = (await admin.from("player_sessions").select("session_id").eq("user_id", id).single()).data?.session_id;
  check("…the first is the player's device now", !!after && after !== before, `${before} → ${after}`);
  await laptop.screenshot({ path: `${OUT}/one-device-2-taken-back.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
