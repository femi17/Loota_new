// Loota Radio (owner, 27 Oct 2026: "enable music or radio, so users can listen as they move"), on a phone: the radio
// tool opens the stations; one tap and a real Nigerian station is live; the next station plays too; it keeps playing
// while the hunter walks; the tool shows it's on; after a reload the station is remembered; off lets go of the stream.
// Needs the internet (the stations' own streams). The test player is deleted.
//   SHOTS=<folder> [ALL=1] node scripts/tests/radio-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const yaba = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `radio-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(12000);
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());

  const tool = () => page.evaluate(() => document.querySelector('[data-tool="radio"]')?.getAttribute("aria-label"));
  const status = () => page.evaluate(() => document.querySelector('[aria-label="Radio status"]')?.textContent ?? "");
  const nowOn = () => page.evaluate(() => document.querySelector('[aria-label="Loota Radio"] p.truncate.font-bold')?.textContent ?? "");
  const live = async (s = 25) => {
    let st = "";
    for (let i = 0; i < s && !/Live/.test(st); i++) {
      await wait(1000);
      st = await status();
    }
    return st;
  };
  check("the radio tool, off", (await tool()) === "Radio");
  await page.evaluate(() => document.querySelector('[data-tool="radio"]')?.click());
  await wait(500);
  check("…opens the stations", (await page.evaluate(() => document.querySelectorAll('[aria-label="Stations"] li').length)) >= 8);
  await page.evaluate(() => document.querySelector('[aria-label="Turn the radio on"]')?.click());
  const first = await nowOn();
  check(`on: ${first} is live`, /Live/.test(await live()), await status());
  check("…the tool shows it's playing", (await tool()) === "Radio: playing");
  await page.screenshot({ path: `${OUT}/radio-1-live.png` });

  await page.evaluate(() => document.querySelector('[aria-label="Next station"]')?.click());
  const second = await nowOn();
  check(`next station (${second}) is live too`, second !== first && /Live/.test(await live()), await status());

  // Walk with it playing: the panel closed, ↑ held for 8 s.
  await page.evaluate(() => document.querySelector('[aria-label="Loota Radio"] button[aria-label="Close"]')?.click());
  await page.keyboard.down("ArrowUp");
  await wait(8000);
  await page.keyboard.up("ArrowUp");
  check("still playing after walking", (await tool()) === "Radio: playing");
  await page.evaluate(() => document.querySelector('[data-tool="radio"]')?.click());
  await wait(400);
  check("…live", /Live/.test(await status()), await status());

  // Remembered after a reload (and back on at the first touch).
  await page.reload({ waitUntil: "domcontentloaded" });
  await wait(12000);
  await page.mouse.click(200, 500);
  await page.evaluate(() => document.querySelector('[data-tool="radio"]')?.click());
  await wait(400);
  check("after a reload: the same station", (await nowOn()) === second, await nowOn());
  check("…back on at the first touch", /Live/.test(await live()), await status());

  // ALL=1: every station on the dial answers (a check before launch, and now and then: streams move).
  if (process.env.ALL) {
    const n = await page.evaluate(() => document.querySelectorAll('[aria-label="Stations"] li').length);
    for (let i = 0; i < n; i++) {
      await page.evaluate((k) => document.querySelectorAll('[aria-label="Stations"] li button')[k]?.click(), i);
      check(`station ${i + 1}: ${await nowOn()}`, /Live/.test(await live()), await status());
    }
  }

  await page.evaluate(() => document.querySelector('[aria-label="Turn the radio off"]')?.click());
  await wait(500);
  check("off", (await status()) === "Off" && (await tool()) === "Radio");
  await page.screenshot({ path: `${OUT}/radio-2-off.png` });
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
