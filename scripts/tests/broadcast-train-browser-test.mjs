// A train on the broadcast (owner, 8 Nov 2026: "The train movement is wierd. It moves too fast" — on the broadcast too:
// "yes, it should be so"). The owner's broadcast follows a hunter aboard a train on a real, winding line (copied from a
// past trip, ~27 km in under two minutes): it pulls away slowly, and at full speed the camera is pulled back so it
// crosses the screen at a steady pace, as on the hunter's laptop. The hunt and accounts are deleted.
//   SHOTS=<folder> node scripts/tests/broadcast-train-browser-test.mjs
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
const ids = [];
let huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const user = async (tag) => {
  const email = `btrain-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};

try {
  const { data: src, error: srcErr } = await admin.from("transit_trips").select("line_id, from_name, to_name, to_lng, to_lat, path, path_m").eq("id", SOURCE_TRIP).single();
  if (srcErr) throw srcErr;
  const start = { lng: src.path[0][0], lat: src.path[0][1] };
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Rail${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast train test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });
  const secs = Math.min(480, 90 + (src.path_m / 100_000) * 45);
  const departs = Date.now() + 40_000;
  const { error: tripErr } = await admin.from("transit_trips").insert({ user_id: hunter.id, mode: "train", line_id: src.line_id, from_name: src.from_name, to_name: src.to_name, to_lng: src.to_lng, to_lat: src.to_lat, path: src.path, path_m: src.path_m, fare: 0,
    departs_at: new Date(departs).toISOString(), arrives_at: new Date(departs + secs * 1000).toISOString() });
  if (tripErr) throw tripErr;

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: owner.email, password: owner.password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  await page.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  while (Date.now() < departs) await wait(100);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const shown = await page.evaluate((id) => { const s = window.__broadcastShown?.(); return s ? { at: s[id] ?? null, zoom: s.zoom, trip: (s.trips ?? []).includes(id), cars: s.trainCars ?? [] } : null; }, hunter.id);
    if (shown?.at) samples.push({ t: Date.now() - departs, ...shown });
    if (samples.length === 60) await page.screenshot({ path: `${OUT}/broadcast-train.png` });
    await wait(250);
  }
  const speeds = samples.slice(1).map((b, i) => ({ t: b.t, mps: metres(samples[i].at, b.at) / ((b.t - samples[i].t) / 1000), zoom: b.zoom, lat: b.at.lat }));
  // (full speed: the 90th percentile of the speeds read, not the highest: on this busy machine a reading is now and then
  // timed late, and one such spike set "top" and failed the camera check though the train ran evenly)
  const sortedMps = speeds.map((v) => v.mps).sort((a, b) => a - b);
  const top = sortedMps[Math.floor(sortedMps.length * 0.9)] ?? 0;
  if (process.env.DEBUG) console.log("  speeds:", speeds.map((v) => `${(v.t / 1000).toFixed(1)}s:${Math.round(v.mps)}`).join(" "));
  const early = speeds.filter((v) => v.t < 3000).map((v) => v.mps);
  check("on the broadcast, known as a trip", samples.some((s) => s.trip));
  check("it pulls away slowly, not leaping off at full speed", early.length > 3 && Math.max(...early) < top * 0.5, `first 3 s up to ${Math.round(Math.max(...early))} m/s; full speed ${Math.round(top)} m/s`);
  const fast = speeds.filter((v) => v.mps > top * 0.9);
  const px = fast.map((v) => v.mps / ((40075016.686 * Math.cos((v.lat * Math.PI) / 180)) / (512 * 2 ** v.zoom)));
  const pxMid = [...px].sort((a, b) => a - b)[Math.floor(px.length / 2)] ?? Infinity;
  const zoomMid = [...fast.map((v) => v.zoom)].sort((a, b) => a - b)[Math.floor(fast.length / 2)] ?? 99;
  check("at full speed the camera is pulled back: a steady pace across the screen", fast.length > 5 && pxMid < 220 && zoomMid < 15.8, `${Math.round(pxMid)} px a second (typical; the highest reading ${Math.round(Math.max(...px))}) at zoom ${zoomMid.toFixed(1)} (was zoom 16)`);
  // All its carriages, as on their own screen (owner, 13 Nov 2026: "Train on broadcast is just one coach, on user screen 3")
  const withCars = samples.filter((x) => x.t > 5000 && x.cars.length);
  const gaps = withCars.flatMap((x) => x.cars.slice(1).map((c, i) => metres(x.cars[i], c)));
  const sizes = [...new Set(withCars.map((x) => x.cars.length))];
  const even = withCars.every((x) => { const g = x.cars.slice(1).map((c, i) => metres(x.cars[i], c)); return g.length === 2 && g[0] > 3 && Math.abs(g[0] - g[1]) < Math.max(g[0], g[1]) * 0.35; });
  check("the train on the broadcast: 3 carriages end to end, as on their screen", sizes.length === 1 && sizes[0] === 3 && even, `carriages ${sizes.join("/")}; gaps ${Math.round(Math.min(...gaps))}–${Math.round(Math.max(...gaps))} m`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  for (const id of ids) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
