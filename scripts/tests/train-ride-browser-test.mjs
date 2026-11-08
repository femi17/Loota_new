// A train ride on the map (owner, 8 Nov 2026: "The train movement is wierd. It moves too fast, and the coaches are
// disjointed when it does"). A player aboard a train on a real, winding line (copied from a past trip: Tokyo's
// Den-en-toshi line, about 27 km in under two minutes). Sampled as it goes:
//   - at the station before it leaves: the three carriages end to end on the track, not on top of each other;
//   - it pulls away (slow at first) instead of leaping off at full speed;
//   - at full speed it crosses the screen at a steady pace (the camera pulls back for it), not a blur;
//   - all the way: the carriages stay coupled (the gap between them the same) and each lies along the track.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/train-ride-browser-test.mjs
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
const SOURCE_TRIP = "ffd5d8e1-a75b-4e5d-9a82-fef1615290b6"; // 三軒茶屋 → つきみ野, 26.9 km
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const angle = (a, b) => { const d = Math.abs(((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
// The game's own heading (geo.headingOf: x east, z south).
const headingOf = (from, to) => Math.atan2((to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180), -(to.lat - from.lat));

try {
  const { data: src, error: srcErr } = await admin.from("transit_trips").select("line_id, from_name, to_name, to_lng, to_lat, path, path_m").eq("id", SOURCE_TRIP).single();
  if (srcErr) throw srcErr;
  const start = { lng: src.path[0][0], lat: src.path[0][1] };
  const email = `train-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const secs = Math.min(480, 90 + (src.path_m / 100_000) * 45); // trainS()
  const departs = Date.now() + 30_000;
  const { error } = await admin.from("transit_trips").insert({ user_id: id, mode: "train", line_id: src.line_id, from_name: src.from_name, to_name: src.to_name, to_lng: src.to_lng, to_lat: src.to_lat, path: src.path, path_m: src.path_m, fare: 0,
    departs_at: new Date(departs).toISOString(), arrives_at: new Date(departs + secs * 1000).toISOString() });
  if (error) throw error;
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const rideNow = () => page.evaluate(() => window.__lootaRide?.() ?? null);
  for (let t = 0; t < 60 && !(await rideNow()); t++) await wait(500);

  // At the station
  while (Date.now() < departs - 3000) await wait(250);
  const waiting = await rideNow();
  const ends = waiting ? metres(waiting.parts[0], waiting.parts[waiting.parts.length - 1]) : 0;
  check("at the station: the carriages end to end on the track, not on top of each other", !!waiting && waiting.parts.length === 3 && ends > waiting.spacing * 1.6, waiting ? `first to last ${ends.toFixed(0)} m, a carriage ${waiting.spacing.toFixed(0)} m` : "no ride");
  await page.screenshot({ path: `${OUT}/train-1-station.png` });

  // Under way: sampled every 250 ms for 30 s
  while (Date.now() < departs) await wait(50);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const r = await rideNow();
    if (r) samples.push({ at: Date.now() - departs, ...r });
    if (samples.length === 60) await page.screenshot({ path: `${OUT}/train-2-moving.png` });
    await wait(250);
  }
  const speeds = samples.slice(1).map((b, i) => ({ at: b.at, mps: (b.s - samples[i].s) / ((b.at - samples[i].at) / 1000), zoom: b.zoom, lat: b.parts[0].lat }));
  const early = speeds.filter((v) => v.at < 3000).map((v) => v.mps);
  const top = Math.max(...speeds.map((v) => v.mps));
  check("it pulls away: slow at first, not leaping off at full speed", early.length > 3 && Math.max(...early) < top * 0.5, `first 3 s up to ${Math.round(Math.max(...early))} m/s; full speed ${Math.round(top)} m/s`);
  const px = speeds.filter((v) => v.mps > top * 0.9).map((v) => v.mps / ((40075016.686 * Math.cos((v.lat * Math.PI) / 180)) / (512 * 2 ** v.zoom)));
  const fastest = Math.max(...px);
  check("at full speed: a steady pace across the screen, the camera pulled back (not a blur)", px.length > 5 && fastest < 220, `${Math.round(fastest)} px a second at zoom ${speeds.find((v) => v.mps > top * 0.9)?.zoom.toFixed(1)} (was over 250 at zoom 16)`);
  // Coupled: the gap between carriages stays the carriage length; each lies along the line between its neighbours.
  let worstGap = 0, worstTurn = 0;
  for (const s of samples) {
    for (let i = 1; i < s.parts.length; i++) {
      const gap = metres(s.parts[i - 1], s.parts[i]);
      worstGap = Math.max(worstGap, Math.abs(gap - s.spacing) / s.spacing);
    }
    const along = headingOf(s.parts[2], s.parts[0]);
    worstTurn = Math.max(worstTurn, angle(s.parts[1].heading, along));
  }
  check("all the way: the carriages stay coupled (the same gap between them)", samples.length > 80 && worstGap < 0.2, `gaps within ${(worstGap * 100).toFixed(0)}% of a carriage over ${samples.length} samples`);
  check("…and lie along the track (not turned across it)", worstTurn < (35 * Math.PI) / 180, `the middle carriage at most ${Math.round((worstTurn * 180) / Math.PI)}° off the line through the others`);
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
