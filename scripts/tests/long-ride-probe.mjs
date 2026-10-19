// A long ride at full speed (holding ↑), logging every second how far the player went and anything that stopped them.
// SLOW=1 throttles the network like a slow phone connection (latency 400 ms, 1.6 Mbps). The test player is deleted.
//   SECONDS=90 SLOW=1 node scripts/tests/long-ride-probe.mjs <lng> <lat> [mode]
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
const mode = process.argv[4] ?? "motorbike";
const SECONDS = Number(process.env.SECONDS ?? 90);
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, browser;
try {
  const email = `ride-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: lng, home_lat: lat, home_set_at: new Date().toISOString(), rider_licence: true, driver_licence: true }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Long ride probe" });
  if (mode !== "walk") await admin.from("player_vehicles").insert({ user_id: id, kind: mode, fuel: 100, tyre: 100, engine: 100, lng, lat, in_use: true, helmet: true, registered: true, insured: true, light: true });
  await admin.from("player_positions").upsert({ user_id: id, lng, lat, mode, energy: 100, updated_at: ago(20) });
  // No road events in this probe (one "just happened")
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
  // SAVES=1: every save_position sent and what the server said
  const t0 = Date.now();
  if (process.env.SAVES) {
    page.on("request", (r) => {
      if (r.url().includes("/rpc/save_position")) console.log(`  ${((Date.now() - t0) / 1000).toFixed(2)}s save → ${r.postData()}`);
    });
    page.on("response", async (r) => {
      if (!r.url().includes("/rpc/save_position")) return;
      const body = await r.text().catch(() => "");
      console.log(`  ${((Date.now() - t0) / 1000).toFixed(2)}s     ← ${body.slice(0, 140)}`);
    });
  }
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  if (process.env.SLOW) await page.emulateNetworkConditions({ download: 200000, upload: 100000, latency: 400 });
  const state = () => page.evaluate(() => {
    const map = window.__lootaMap;
    const c = map.getCenter();
    const chips = [...document.querySelectorAll('[role="status"], [aria-live]')].map((e) => e.textContent?.trim()).filter(Boolean).join(" / ");
    const street = document.body.innerText.match(/\n([^\n]*(Road|Street|road|Avenue|Expressway|Way)[^\n]*)\n/)?.[1] ?? "";
    return { lng: c.lng, lat: c.lat, chips: chips.slice(0, 160), dialog: document.querySelector('[role="dialog"]')?.getAttribute("aria-label") ?? "", roads: document.querySelector("[data-roads]")?.getAttribute("data-roads") ?? "", street };
  });
  await page.keyboard.down("ArrowUp");
  let prev = await state();
  let total = 0, stalled = 0;
  for (let s = 1; s <= SECONDS; s++) {
    await wait(1000);
    const now = await state();
    const d = Math.hypot((now.lng - prev.lng) * 111320 * Math.cos((lat * Math.PI) / 180), (now.lat - prev.lat) * 110574);
    total += d;
    if (d < 20) stalled++;
    if (d < 20 || s % 10 === 0 || now.dialog || /corrected/.test(now.chips))
      console.log(`t=${s}s +${Math.round(d)} m (total ${Math.round(total)})  ${now.lng.toFixed(5)},${now.lat.toFixed(5)}  roads=${now.roads} ${now.street} ${now.dialog ? `[${now.dialog}]` : ""} ${now.chips}`);
    prev = now;
  }
  await page.keyboard.up("ArrowUp");
  console.log(`stalled seconds: ${stalled} of ${SECONDS}; problems: ${problems.join(" // ") || "none"}`);
  await page.screenshot({ path: process.env.SHOT ?? "ride.png" });
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}
