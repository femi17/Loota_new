// How much map a phone loads when the game opens: a test player in Yaba; counts the map-tile requests and their size
// in the first 25 s, and how long until the hunter is on a road. The test player is deleted.
//   node scripts/tests/tile-load-probe.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const at = { lng: 3.3787, lat: 6.5186 };
let browser, id = null;
try {
  const email = `tiles-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 90, updated_at: new Date().toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  let tiles = 0, bytes = 0;
  page.on("response", async (r) => {
    if (!/tiles\.openfreemap\.org\/.*\.pbf|\/planet\/\d+\/\d+\/\d+/.test(r.url())) return;
    tiles++;
    bytes += Number(r.headers()["content-length"] ?? 0) || (await r.buffer().catch(() => Buffer.alloc(0))).length;
  });
  const t0 = Date.now();
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  let ready = null;
  while (Date.now() - t0 < 25000) {
    await wait(250);
    if (!ready && (await page.evaluate(() => !!window.__lootaRoad?.()))) ready = (Date.now() - t0) / 1000;
  }
  console.log(`map tiles in 25 s: ${tiles} (${(bytes / 1024).toFixed(0)} KB) · on a road after ${ready ?? "never"} s`);
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
}
