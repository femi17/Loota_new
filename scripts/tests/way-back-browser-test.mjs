// Getting the way back after a tap on the map by mistake (owner, 1 Nov 2026: "I made a mistake to point on the map and
// it created another path, there is no way to get the direction back… I should be able from the compass get the
// direction back").
//   1. Directions to a place, then a tap on the map: the card offers "↩ Back to" the place, and it brings the way back.
//   2. Another tap, then End: back on the way to the place (not the end of directions).
//   3. A journey under way (🧭), then a tap on the map: the journey card offers "Show the way", which draws its step again.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/way-back-browser-test.mjs
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
const HOME = { lng: 3.3787, lat: 6.5186 };
// A journey's last step: walk to a spot a few streets away (the planner's own shape).
const PLACE = { name: "Test Corner", detail: "", lng: 3.3815, lat: 6.5215 };
const JOURNEY = { journey: { mode: "coach", place: PLACE, legs: [{ kind: "go", to: { name: PLACE.name, lng: PLACE.lng, lat: PLACE.lat }, metres: 500, seconds: 300, fare: null, how: "Walk" }], seconds: 300, fare: null }, step: 0 };

async function until(page, fn, arg, ms = 30000) {
  for (let t = 0; t < ms; t += 400) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await wait(400); }
  return false;
}
const directions = (page) => page.evaluate(() => document.querySelector('[aria-label="Directions"]')?.innerText ?? "");
async function tapMap(page, fx, fy) {
  const c = await (await page.$("canvas.maplibregl-canvas")).boundingBox();
  await page.mouse.click(c.x + c.width * fx, c.y + c.height * fy);
}

try {
  const email = `wayback-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: HOME.lng, lat: HOME.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(page, () => !!document.querySelector('[data-tool="directions"]') && document.querySelector("[data-roads]")?.getAttribute("data-roads") !== null, null, 60000);
  await wait(4000);

  // 1. Directions to a place, then a stray tap
  await page.evaluate(() => document.querySelector('[data-tool="directions"]').click());
  await until(page, () => !!document.querySelector('input[type="search"]'));
  await page.type('input[type="search"]', "Unilag Senate Building");
  await until(page, () => !!document.querySelector('[aria-label="Places found"] [role="option"] button'));
  const placeName = await page.evaluate(() => { const b = document.querySelector('[aria-label="Places found"] [role="option"] button'); const n = b.querySelector("span, b, p")?.textContent ?? b.textContent; b.click(); return n.trim(); });
  const routed = await until(page, () => /^To /m.test(document.querySelector('[aria-label="Directions"]')?.innerText ?? ""));
  const first = await directions(page);
  check("directions to a place", routed, first.split("\n").slice(-1)[0]);
  await tapMap(page, 0.75, 0.75);
  const replaced = await until(page, () => (document.querySelector('[aria-label="Directions"]')?.innerText ?? "").includes("To the marked spot"));
  const offer = await directions(page);
  check("a tap on the map: the way to the marked spot, with a way back", replaced && offer.includes("↩ Back to"), offer.replace(/\n/g, " | ").slice(0, 160));
  await page.screenshot({ path: `${OUT}/way-back-offer.png` });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("↩ Back to"))?.click());
  const back = await until(page, () => { const t = document.querySelector('[aria-label="Directions"]')?.innerText ?? ""; return /^To /m.test(t) && !t.includes("marked spot"); });
  check("…and it brings the way back", back && !(await directions(page)).includes("↩"), (await directions(page)).split("\n").slice(-1)[0]);

  // 2. Another stray tap, then End
  await tapMap(page, 0.3, 0.75);
  await until(page, () => (document.querySelector('[aria-label="Directions"]')?.innerText ?? "").includes("To the marked spot"));
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Directions"] button')].find((b) => b.textContent.trim() === "End")?.click());
  const ended = await until(page, () => { const t = document.querySelector('[aria-label="Directions"]')?.innerText ?? ""; return /^To /m.test(t) && !t.includes("marked spot"); });
  check("End on the mistaken way: back on the way to the place", ended);
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Directions"] button')].find((b) => b.textContent.trim() === "End")?.click());
  check("…and End again ends the directions", await until(page, () => !document.querySelector('[aria-label="Directions"]')));

  // 3. A journey under way
  await page.evaluate((j) => localStorage.setItem("loota:journey", JSON.stringify(j)), JOURNEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  const going = await until(page, (n) => (document.querySelector('[aria-label="Directions"]')?.innerText ?? "").includes(`To ${n}`), PLACE.name, 60000);
  check("a journey under way: its step is drawn", going && !!(await page.$('[aria-label="Your journey"]')));
  await wait(1500);
  await tapMap(page, 0.75, 0.75);
  const lost = await until(page, () => (document.querySelector('[aria-label="Your journey"]')?.innerText ?? "").includes("Show the way"));
  check("a tap on the map: the journey card offers Show the way", lost);
  await page.screenshot({ path: `${OUT}/way-back-journey.png` });
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Your journey"] button')].find((b) => b.textContent.includes("Show the way"))?.click());
  const again = await until(page, (n) => (document.querySelector('[aria-label="Directions"]')?.innerText ?? "").includes(`To ${n}`), PLACE.name);
  const settled = await until(page, () => !(document.querySelector('[aria-label="Your journey"]')?.innerText ?? "").includes("Show the way"), null, 5000);
  check("…which draws the journey's step again", again && settled, `drawn ${again}, offer gone ${settled}: ${(await directions(page)).replace(/\n/g, " | ")}`);
  void placeName;
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
