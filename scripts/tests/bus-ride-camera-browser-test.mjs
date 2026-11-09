// A city bus ride's camera (owner, 9 Nov 2026: "the km of the plane is running fast but the plane move is not too fast.
// Same thing should apply to the buses and trains. I took a bus sometime… the bus was just moving too fast"). A player
// aboard a real Lagos bus ride (copied from a past trip: MMIA Arrivals to the Lagos–Badagry Expressway, 15.9 km in under
// two minutes, with its stops and lights). Sampled every 250 ms the whole way:
//   - the bus never crosses the screen faster than 220 pixels a second (the camera pulled back as its speed needs);
//   - mostly at an easy pace (as the train's and the plane's);
//   - mid-ride the camera holds its height through the stops and lights, not in and out at each.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/bus-ride-camera-browser-test.mjs
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
const SOURCE_TRIP = "3fa0a635-62bc-422d-a2c2-515389aac3bb"; // MMIA Arrivals → Lagos Badagry Expressway, 15.9 km
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const mPerPx = (lat, zoom) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

try {
  const { data: src, error: srcErr } = await admin.from("transit_trips").select("from_name, to_name, to_lng, to_lat, path, path_m").eq("id", SOURCE_TRIP).single();
  if (srcErr) throw srcErr;
  const start = { lng: src.path[0][0], lat: src.path[0][1] };
  const email = `busride-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const secs = Math.min(210, 45 + (src.path_m / 1000) * 4); // busS()
  const departs = Date.now() + 30_000;
  const { error } = await admin.from("transit_trips").insert({ user_id: id, mode: "bus", from_name: src.from_name, to_name: src.to_name, to_lng: src.to_lng, to_lat: src.to_lat, path: src.path, path_m: src.path_m, fare: 0,
    departs_at: new Date(departs).toISOString(), arrives_at: new Date(departs + secs * 1000).toISOString() });
  if (error) throw error;
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const rideNow = () => page.evaluate(() => window.__lootaRide?.() ?? null);
  for (let t = 0; t < 60 && !(await rideNow()); t++) await wait(500);

  // The whole ride, every 250 ms
  while (Date.now() < departs) await wait(50);
  const samples = [];
  while (Date.now() < departs + secs * 1000 + 2000) {
    const r = await rideNow();
    if (r) samples.push({ at: Date.now() - departs, ...r });
    if (samples.length === 120) await page.screenshot({ path: `${OUT}/bus-ride-moving.png` });
    await wait(250);
  }
  const moves = samples.slice(1).map((b, i) => ({ at: b.at, mps: (b.s - samples[i].s) / ((b.at - samples[i].at) / 1000), zoom: b.zoom, lat: b.parts[0].lat })).filter((v) => v.mps > 1);
  const px = moves.map((v) => v.mps / mPerPx(v.lat, v.zoom)).sort((a, b) => a - b);
  const top = Math.max(...moves.map((v) => v.mps));
  const fastest = px[px.length - 1], usual = px[Math.floor(px.length / 2)];
  const was = top / mPerPx(moves[0]?.lat ?? 6.5, 17.5); // on a phone, as close as walking
  check("never faster than 220 pixels a second across the screen", moves.length > 40 && fastest < 220, `${Math.round(fastest)} px/s at the most (its top speed ${Math.round(top)} m/s would be ${Math.round(was)} px/s with the camera as close as walking)`);
  check("…mostly an easy pace", usual < 160, `${Math.round(usual)} px/s typically`);
  // Mid-ride (past its first and last 10 s): the camera's height steady through stops and lights
  const mid = samples.filter((s) => s.at > 10_000 && s.at < secs * 1000 - 10_000).map((s) => s.zoom);
  const spread = Math.max(...mid) - Math.min(...mid);
  check("mid-ride the camera holds its height (not in and out at each stop)", mid.length > 40 && spread < 0.3, `zoom ${Math.min(...mid).toFixed(2)}–${Math.max(...mid).toFixed(2)} over ${mid.length} samples`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
