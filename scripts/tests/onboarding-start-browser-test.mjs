// Starting anywhere at onboarding (owner, 5 Nov 2026: "Let user doing onboarding instead of picking their real
// location, they should also have a choice to pick any default location"; a city list and a search): a new player
// (no home yet) on a phone picks a city, then searches for a place instead and picks it, and starts: their home is
// that place. The test player is deleted.   SHOTS=<folder> node scripts/tests/onboarding-start-browser-test.mjs
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

try {
  const email = `onboard-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: `start${Date.now() % 100000}` } });
  id = data.user.id;
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/onboarding", { waitUntil: "networkidle2", timeout: 120000 });
  const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
  const chosen = () => page.evaluate(() => document.querySelector("[data-start-chosen]")?.textContent?.trim() ?? null);

  // 1. The choices: my location, the cities, a search
  const cities = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cities"] button')].map((b) => b.textContent?.trim()));
  check("onboarding: a list of cities to start in", cities.includes("Lagos") && cities.includes("London") && cities.length >= 10, cities.join(", "));
  check("…and a search, and still my location", !!(await page.$('input[aria-label="Search for a starting place"]')) && (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /Use my location/.test(b.textContent ?? "")))));
  // 2. A city
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cities"] button')].find((b) => b.textContent?.trim() === "Accra")?.click());
  check("picking Accra: home is Accra", /Accra/.test((await chosen()) ?? ""), String(await chosen()));
  // 3. A search instead
  await page.type('input[aria-label="Search for a starting place"]', "Kumasi");
  const found = await until(() => page.evaluate(() => document.querySelectorAll('[aria-label="Places found"] button').length), 20000);
  check("searching for Kumasi: places found", !!found, String(found));
  await page.evaluate(() => document.querySelector('[aria-label="Places found"] button')?.click());
  check("…picked: home is Kumasi", /Kumasi/.test((await chosen()) ?? ""), String(await chosen()));
  await page.screenshot({ path: `${OUT}/onboarding-start.png` });
  // 4. Start
  await page.evaluate(() => [...document.querySelectorAll('button[type="submit"]')].at(-1)?.click());
  const home = await until(async () => {
    const p = (await admin.from("profiles").select("home_lng, home_lat").eq("id", id).single()).data;
    return p?.home_lng != null ? p : null;
  }, 30000);
  check("started: the home is in Kumasi", !!home && Math.abs(home.home_lng - -1.62) < 0.3 && Math.abs(home.home_lat - 6.69) < 0.3, JSON.stringify(home));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
