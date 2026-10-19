// Can the player move forward? A test player at the given spot on the given vehicle holds ArrowUp; prints how far
// they went, the hint and any page errors. The test player is deleted.
//   node scripts/tests/forward-probe.mjs <lng> <lat> [mode]
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
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, browser;
try {
  const email = `fwd-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: lng, home_lat: lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Forward probe" });
  if (mode !== "walk") await admin.from("player_vehicles").insert({ user_id: id, kind: mode, fuel: 50, tyre: 100, engine: 90, lng, lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: id, lng, lat, mode, energy: 100, updated_at: ago(20) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  const body = () => page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 400));
  console.log("before:", await body());
  await page.keyboard.down("ArrowUp");
  for (let i = 0; i < 6; i++) {
    await wait(2500);
    const pos = (await admin.from("player_positions").select("lng,lat").eq("user_id", id).single()).data;
    const m = Math.hypot((pos.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180), (pos.lat - lat) * 110540);
    console.log(`t=${(i + 1) * 2.5}s moved ${m.toFixed(0)} m`);
  }
  await page.keyboard.up("ArrowUp");
  console.log("after:", await body());
  await page.screenshot({ path: process.env.SHOT ?? "fwd.png" });
  console.log("problems:", problems.join(" // ") || "none");
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
}
