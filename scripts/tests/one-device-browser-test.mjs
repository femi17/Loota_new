// One device a player (owner, 3 Nov 2026: "If a user joins on 2 device, we close one so it doesn't affect the
// broadcast… User should get a message on the screens that wont go away until one is closed"): the same player opens
// the game on two devices: both pause under "Loota is open on 2 …"; "Close it here" on one: the other plays; "Play
// here" again: both paused; the other device's tab closed: this one plays. Two browser windows that share nothing
// stand in for the two devices. The test player is deleted.
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
  const device = async (phone) => {
    const jar = new Map();
    const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
    await c.auth.signInWithPassword({ email, password });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    if (phone) {
      await page.setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36");
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    } else await page.setViewport({ width: 1280, height: 800 });
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => {
      try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
    }, id);
    return page;
  };
  const message = (page) => page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Open on more than one device"]')?.innerText.replace(/\s+/g, " ") ?? "");
  const playing = (page) => page.evaluate(() => !!document.querySelector(".maplibregl-canvas") && !document.querySelector('[aria-label="Open on more than one device"]'));
  const tap = (page, label) => page.evaluate((l) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === l)?.click(), label);
  const until = async (fn, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      if (await fn()) return true;
      await wait(500);
    }
    return false;
  };

  const phone = await device(true);
  await phone.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  check("the phone plays", await playing(phone));
  const laptop = await device(false);
  await laptop.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  check("opened on a computer too: the computer shows the message", await until(async () => /open on a phone and a computer/.test(await message(laptop))), await message(laptop));
  check("…and the phone too (its game paused)", await until(async () => /open on a phone and a computer/.test(await message(phone))), await message(phone));
  await wait(4000);
  check("…the message stays", /open on a phone and a computer/.test(await message(phone)) && /open on a phone and a computer/.test(await message(laptop)));
  await phone.screenshot({ path: `${OUT}/one-device-1-both.png` });
  await tap(laptop, "Close it here");
  check("'Close it here' on the computer: closed there", await until(async () => /Closed on this device/.test(await message(laptop))));
  check("…and the phone plays again", await until(() => playing(phone), 60));
  await tap(laptop, "Play here");
  check("'Play here' on the computer: both paused again", await until(async () => /open on a phone and a computer/.test(await message(phone))) && await until(async () => /open on a phone and a computer/.test(await message(laptop))));
  await phone.close();
  check("the phone's game closed (its tab): the computer plays", await until(() => playing(laptop), 80));
  await laptop.screenshot({ path: `${OUT}/one-device-2-alone.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
