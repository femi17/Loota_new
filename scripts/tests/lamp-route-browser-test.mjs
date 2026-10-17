// "Show me the way" from the lamp follows the roads, even round a fenced airport: a hunter outside
// Lagos airport's terminal asks for the way to a petrol station 1.6 km away in a straight line but
// about 12 km by road. Needs a live hunt. The test Detour and the test player are deleted.
//   node scripts/tests/lamp-route-browser-test.mjs
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
const NL = String.fromCharCode(10);
const ids = [];
const detours = [];
let browser;
try {
  const start = { lng: 3.31996321678162, lat: 6.57846486287691 }; // the road outside the terminal
  const station = { lng: 3.307832, lat: 6.586875 };
  const { data: d } = await admin.from("detours").insert({
    kind: "flash", area: `${Math.floor(start.lng / 0.1)}:${Math.floor(start.lat / 0.1)}`, title: "Test pouch", story: "A test.",
    place_name: "the test petrol station", lng: station.lng, lat: station.lat, reward_coins: 10,
    ends_at: new Date(Date.now() + 240_000).toISOString(), // ends soonest, so the lamp holds it
  }).select("id").single();
  detours.push(d.id);
  const email = `lamp-route-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ username: `Route_${Date.now() % 1000}`, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", updated_at: new Date().toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const { data: hunts } = await c.rpc("list_hunts");
  const live = (hunts ?? []).find((h) => h.phase === "live");
  if (!live) throw new Error("No live hunt to join");
  await c.rpc("join_hunt", { p_hunt: live.id });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  await page.evaluate(() => document.querySelector("[data-tool=lamp]")?.click());
  await wait(3500);
  // A new player's first tap shows the Djinn's summons (if a Wager is on): close it, tap again.
  if (await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="The Djinn"]'))) {
    await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="The Djinn"] button[aria-label="Close"]')?.click());
    await wait(800);
    await page.evaluate(() => document.querySelector("[data-tool=lamp]")?.click());
    await wait(3500);
  }
  console.log("lamp:", (await text('[role="dialog"]'))?.slice(0, 200));
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent?.includes("Show me the way"))?.click());
  await wait(15000);
  console.log("guide:", await text('[role="status"][aria-label="Directions"]'));
  console.log("hint:", await page.evaluate(() => document.querySelector('p[role="status"]')?.textContent ?? ""));
  await page.screenshot({ path: `${OUT}/lamp-route.png` });
  console.log("browser errors:", problems.length ? problems.join(" | ") : "none");
} catch (e) {
  console.log("ERROR", e.message);
} finally {
  await browser?.close().catch(() => {});
  if (detours.length) await admin.from("detours").delete().in("id", detours);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log("test players deleted:", ids.length);
}
