// The trip's icon on a phone counts the kilometres down (owner, 28 Oct 2026: "add the km countdown in the icon for
// travel"), and the plane is a fair size at cruising height ("too big", then "too small"). A test player is ten minutes
// into a flight from Lagos towards Abuja: the ✈ icon shows the km to go and the time to landing, and a few seconds later
// fewer km. Screenshot of the plane in the air. The trip and the test player are deleted.
//   SHOTS=<folder> node scripts/tests/trip-pill-browser-test.mjs
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
const home = { lng: 3.3787, lat: 6.5186 }; // Yaba
const to = { lng: 7.26, lat: 9.0 }; // towards Abuja

try {
  const email = `trippill-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const { error } = await admin.from("transit_trips").insert({
    user_id: id, mode: "plane", from_name: "Lagos", to_name: "Abuja", to_lng: to.lng, to_lat: to.lat,
    path: [[home.lng, home.lat], [to.lng, to.lat]], path_m: 520000, fare: 0,
    departs_at: ago(600), arrives_at: soon(3000), ride_s: 3600,
  });
  if (error) throw error;
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const badge = () => page.evaluate(() => document.querySelector('[data-pill="ride"]')?.textContent?.trim() ?? null);
  const km = (t) => Number(/([\d.]+) km/.exec(t ?? "")?.[1] ?? NaN);
  let first = null;
  for (let i = 0; i < 60 && !/km/.test(first ?? ""); i++) {
    await wait(500);
    first = await badge();
  }
  check("in the air, the ✈ icon shows the km to go and the time to landing", /✈/.test(first ?? "") && /\d+ km/.test(first ?? "") && /\d+:\d\d/.test(first ?? ""), first);
  await wait(8000);
  const later = await badge();
  check("…a few seconds later, fewer km", km(later) < km(first), `${first} → ${later}`);
  await page.screenshot({ path: `${OUT}/trip-pill-plane.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
