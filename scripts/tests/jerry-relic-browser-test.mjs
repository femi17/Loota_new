// Running dry with a Jerry Can relic (owner, 19 Oct 2026: "I had a jerry can, and I was still made to purchase one"),
// on a phone: the tank runs dry; the game says to use the relic right there (no way to a petrol station drawn); the
// gold Jerry Can button fills the tank to 65% and puts you back on; you ride on. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/jerry-relic-browser-test.mjs
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
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `jrelic-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", id);
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 0.3, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("player_relics").insert({ user_id: id, relic: "jerry_can", charges: 1, expires_at: new Date(Date.now() + 5 * 86400e3).toISOString() });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const body = () => page.evaluate((nl) => document.body.innerText.split(nl).join(" | "), NL);
  const bike = async () => (await admin.from("player_vehicles").select("fuel, in_use, stranded_at, lng, lat").eq("user_id", id).single()).data;
  const route = () => page.evaluate(() => (window.__lootaMap.getSource("route").serialize().data?.geometry?.coordinates ?? []).length);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);

  await page.keyboard.down("ArrowUp");
  let b = await bike();
  for (let i = 0; i < 40 && !b.stranded_at; i++) { await wait(1000); b = await bike(); }
  await page.keyboard.up("ArrowUp");
  check("ridden dry: the motorbike stands at the roadside", !!b.stranded_at);
  await wait(6000);
  // Still rolling when it ran dry, the rider is a little way on: the way back to the motorbike, with the relic.
  const said = await body();
  const end = await page.evaluate(() => window.__lootaMap.getSource("route").serialize().data?.geometry?.coordinates?.at(-1) ?? null);
  const toBike = end ? Math.hypot((end[0] - b.lng) * 110400, (end[1] - b.lat) * 110574) : Infinity;
  check("…the Jerry Can relic counts: the way back to the motorbike, not to a petrol station", /Jerry Can relic/.test(said) && toBike < 40, `${Math.round(toBike)} m · ${said.match(/(Carry the[^|]*|Out of fuel[^|]*)/)?.[0]}`);
  await page.screenshot({ path: `${OUT}/jrelic-0-back.png` });
  // Beside it.
  await admin.from("player_positions").update({ lng: b.lng, lat: b.lat, mode: "walk", updated_at: ago(30) }).eq("user_id", id);
  await page.goto("about:blank");
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  check("beside it: no way drawn", (await route()) < 2);
  const button = await page.evaluate(() => [...document.querySelectorAll("button")].some((e) => e.textContent?.includes("Jerry Can") && !e.disabled));
  check("…a gold Jerry Can button", button);
  await page.screenshot({ path: `${OUT}/jrelic-1-dry.png` });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.textContent?.includes("Jerry Can") && !e.disabled)?.click());
  await wait(4000);
  const after = await bike();
  const poured = await body();
  check("tapped: the tank at 65%, back on it", Math.round(after.fuel) === 65 && after.in_use && !after.stranded_at && /Jerry Can poured/.test(poured), JSON.stringify(after));
  const relics = (await admin.from("player_relics").select("charges").eq("user_id", id)).data;
  check("…the relic used up, no jerry can bought", relics[0].charges === 0 && !(await admin.from("player_kegs").select("user_id").eq("user_id", id).maybeSingle()).data);
  await page.screenshot({ path: `${OUT}/jrelic-2-poured.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
