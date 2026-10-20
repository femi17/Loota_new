// Screenshots of the Loota logo where it shows (owner, 19 Oct 2026): home, log in, the lobby, and a hunt on the map
// (the countdown, the first riddle, the hunt card). A throwaway hunt "Logo test (automated)" and the test player are
// deleted.   SHOTS=<folder> node scripts/tests/logo-shots.mjs
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
const start = { lng: 3.3787, lat: 6.5186 };

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const logos = () => page.evaluate(() => [...document.querySelectorAll('img[alt="Loota"]')].filter((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0).length);

  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2", timeout: 120000 });
  check("home: the logo", (await logos()) >= 1);
  await page.screenshot({ path: `${OUT}/logo-1-home.png` });
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle2", timeout: 120000 });
  check("log in: the logo", (await logos()) >= 1);
  await page.screenshot({ path: `${OUT}/logo-2-login.png` });
  const icon = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute("href")));
  check("the app icon is the logo", icon.some((h) => h?.includes("icon")), JSON.stringify(icon));

  // A player and a hunt starting in a moment
  const email = `logo-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/lobby", { waitUntil: "networkidle2", timeout: 120000 });
  check("the lobby: the logo", (await logos()) >= 1);
  await page.screenshot({ path: `${OUT}/logo-3-lobby.png` });
  // The map in free roam: the logo in the top bar, with the way back to the lobby.
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await new Promise((r) => setTimeout(r, 15000));
  check("the map (free roam): the logo in the top bar", await page.evaluate(() => {
    const img = document.querySelector('a[aria-label="Back to the lobby"] img[alt="Loota"]');
    return !!img && img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().top < 80;
  }));
  await page.screenshot({ path: `${OUT}/logo-3b-play.png` });

  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Logo test (automated)", prize: "none", winners: 3, starts_at: new Date(Date.now() + 40_000).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where the lagoon meets the bridge, the key waits.", category: "maths", area_lng: 3.45, area_lat: 6.58, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.58 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  let counting = false;
  for (let i = 0; i < 60 && !counting; i++) {
    await wait(500);
    counting = await page.evaluate(() => /The hunt starts in/i.test(document.body.innerText));
  }
  await wait(1200);
  check("the countdown: the logo above it", counting && (await logos()) >= 1);
  await page.screenshot({ path: `${OUT}/logo-4-countdown.png` });
  let riddle = false;
  for (let i = 0; i < 40 && !riddle; i++) {
    await wait(500);
    riddle = await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="The first riddle"] img[alt="Loota"]'));
  }
  check("the first riddle: the logo on it", riddle);
  await wait(800);
  await page.screenshot({ path: `${OUT}/logo-5-riddle.png` });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Let's go"))?.click());
  await wait(1500);
  check("the hunt: the logo in the top bar", await page.evaluate(() => !!document.querySelector('a[aria-label="Back to the lobby"] img[alt="Loota"]')));
  await page.screenshot({ path: `${OUT}/logo-6-card.png` });
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
