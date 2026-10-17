// Resting by the road (phone): a tired cyclist taps Rest here and sits at the roadside, the bicycle standing beside;
// riding on, they're back on the bicycle in the lane. Screenshots only, for the eye. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/rest-pose-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

const spot = { lng: 3.3755, lat: 6.5145 }; // a street in Yaba, away from chill spots
try {
  const email = `rest-b-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 100, engine: 100, lng: spot.lng, lat: spot.lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "bicycle", energy: 40, updated_at: ago(5) });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll("button")].find((y) => (y.textContent?.includes(x) || y.getAttribute("aria-label")?.includes(x)) && !y.disabled); b?.click(); return !!b; }, t);
  const hint = () => page.evaluate(() => document.querySelector('p[role="status"]')?.textContent ?? "");

  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  await page.screenshot({ path: `${OUT}/rest-0-riding.png` });
  check("tired on the bicycle: Rest here", await clickText("Rest here"));
  await wait(2500);
  check("resting by the road", /sit down/i.test(await hint()), await hint());
  await page.screenshot({ path: `${OUT}/rest-1-sitting.png` });

  // Ride on: hold ↑ for a moment.
  await page.keyboard.down("ArrowUp");
  await wait(1500);
  await page.keyboard.up("ArrowUp");
  await wait(800);
  await page.screenshot({ path: `${OUT}/rest-2-on-again.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
