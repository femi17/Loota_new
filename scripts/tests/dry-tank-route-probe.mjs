// Run dry on a motorbike at a spot, tap "Directions" on the "Out of fuel" advice, and measure the drawn route: its
// length, its longest straight piece, and whether it's a road route or a straight line. SLOW=1 throttles the network.
//   node scripts/tests/dry-tank-route-probe.mjs <lng> <lat>
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [lng, lat] = [Number(process.argv[2]), Number(process.argv[3])];
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, browser;
try {
  const email = `dry-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: lng, home_lat: lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", id);
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 0.15, tyre: 100, engine: 100, lng, lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: id, lng, lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
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
  page.on("request", (r) => { if (r.url().includes("routing.openstreetmap.de")) console.log("  asked the routing service"); });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  if (process.env.SLOW) await page.emulateNetworkConditions({ download: 200000, upload: 100000, latency: 400 });
  await page.keyboard.down("ArrowUp");
  let advice = null;
  for (let i = 0; i < 40 && !advice; i++) {
    await wait(1000);
    advice = await page.evaluate(() => document.querySelector('button[aria-label^="Directions to"]')?.getAttribute("aria-label") ?? null);
  }
  await page.keyboard.up("ArrowUp");
  console.log("advice:", advice);
  const where = (await admin.from("player_positions").select("lng,lat,mode").eq("user_id", id).single()).data;
  console.log("ran dry at", where);
  await page.evaluate(() => document.querySelector('button[aria-label^="Directions to"]')?.click());
  await wait(15000);
  const route = await page.evaluate(() => {
    const src = window.__lootaMap.getSource("route");
    const d = src.serialize().data;
    const coords = d?.geometry?.coordinates ?? d?.features?.[0]?.geometry?.coordinates ?? [];
    return { coords, said: document.body.innerText.match(/(Directions to[^\n]*|Road directions[^\n]*|Finding a route[^\n]*)/)?.[0] ?? "" };
  });
  const m = (a, b) => Math.hypot((a[0] - b[0]) * 110400, (a[1] - b[1]) * 110574);
  let total = 0, longest = 0;
  for (let i = 1; i < route.coords.length; i++) { const d = m(route.coords[i - 1], route.coords[i]); total += d; longest = Math.max(longest, d); }
  console.log(`route: ${route.coords.length} points, ${Math.round(total)} m, longest straight piece ${Math.round(longest)} m; "${route.said}"`);
  await page.screenshot({ path: process.env.SHOT ?? "dry.png" });
  console.log("problems:", problems.join(" // ") || "none");
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}
