// The idling law on the broadcast (owner, 12 Nov 2026: "The lockup should happen on the broadcast page too"). A hunter in
// a live test hunt, on their motorbike on Western Avenue (a main road), followed on the owner's broadcast:
//   1. an hour still there: locked up on their own screen;
//   2. on the broadcast: their marker says so, the cell drawn round them, the note (time left, the motorbike impounded),
//      🚔 CELL on the leaderboard, and the news banner;
//   3. they pay bail: on the broadcast the cell goes, and the news says they walked out.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-jail-browser-test.mjs
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
const ids = [];
let huntId = null, browser, browser2;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 500) { const v = await fn(); if (v) return v; await wait(500); } return null; };
const start = { lng: 3.3620, lat: 6.4975 }; // Western Avenue, Surulere
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bjail-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};
const signedIn = async (u) => {
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: u.email, password: u.password });
  return jar;
};

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Idler${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), coins: 1000, rider_licence: true }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "motorbike", lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast jail test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });
  await admin.from("road_events").insert({ user_id: hunter.id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

  browser = await launch();
  browser2 = await launch();
  const problems = [];
  const game = await (await browser.createBrowserContext()).newPage();
  await game.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  game.on("pageerror", (e) => problems.push(e.message));
  await game.setCookie(...[...(await signedIn(hunter))].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await game.evaluateOnNewDocument((id) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); } catch {} }, hunter.id);
  await game.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(async () => (await admin.from("player_positions").select("on_main_road").eq("user_id", hunter.id).single()).data?.on_main_road === true, 60000);

  const show = await (await browser2.createBrowserContext()).newPage();
  await show.setViewport({ width: 1280, height: 800 });
  show.on("pageerror", (e) => problems.push(e.message));
  await show.setCookie(...[...(await signedIn(owner))].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await show.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  await wait(4000);

  // 1. An hour still on the main road: arrested
  await admin.from("player_positions").update({ still_since: ago(65 * 60) }).eq("user_id", hunter.id);
  await game.evaluate(() => window.__lootaLaw?.());
  const text = () => show.evaluate(() => document.body.innerText).catch(() => "");

  // 2. On the broadcast: the patrol car taking them along the road, then the cell at the station
  const car = await until(async () => { const b = await show.evaluate(() => window.__broadcastShown?.() ?? null); return b?.policeCar && new RegExp(`🚓 ${name} · arrested`).test(await text()) ? b.policeCar : null; }, 60000);
  check("1. arrested: on the broadcast the patrol car with them, their marker says so", !!car, JSON.stringify(car));
  const taking = await until(async () => (await text()).split("\n").find((l) => /🚓 .*taking them to/.test(l)) ?? null, 20000);
  check("…the note: the police are taking them to the station", !!taking, taking);
  await show.screenshot({ path: `${OUT}/broadcast-jail-0-ride.png` });
  const jailed = await until(() => game.evaluate(() => !!document.querySelector("[data-jail-left]")), 90000); // (the cell, not the arrest card)
  check("2. in the cell at the station (their screen)", !!jailed);
  const arrest = (await admin.from("idle_arrests").select("station, station_lng, station_lat").eq("user_id", hunter.id).single()).data;
  const cell = await until(() => show.evaluate(() => window.__broadcastShown?.().jailCell ?? null), 20000);
  const atStation = cell && Math.hypot((cell.lng - arrest.station_lng) * 110000, (cell.lat - arrest.station_lat) * 110000) < 40;
  check("…on the broadcast: the cell drawn at the station (not where they were caught)", !!atStation, `${arrest.station}; cell ${JSON.stringify(cell)}`);
  const label = await until(async () => new RegExp(`🚔 ${name} · in the cell`).test(await text()), 15000);
  check("…their marker: in the cell", !!label);
  const note = await until(async () => (await text()).split("\n").find((l) => /🚔 .*in the cell at/.test(l)) ?? null, 15000);
  check("…the note: in the cell at the station, the time left, the motorbike impounded", !!note && note.includes(arrest.station) && /min left/.test(note) && /motorbike impounded/.test(note), note);
  const tag = await show.evaluate(() => !!document.querySelector("[data-cell-tag]"));
  check("…🚔 CELL on the leaderboard", tag);
  const news = await until(async () => new RegExp(`was arrested for idling on a main road and taken to ${arrest.station}`).test(await text()), 30000);
  check("…and the news: arrested and taken to the station", !!news);
  await show.screenshot({ path: `${OUT}/broadcast-jail-1.png` });

  // 3. Bail: out on the broadcast too
  await game.evaluate(() => document.querySelector("[data-bail]")?.click());
  await until(() => game.evaluate(() => !document.querySelector("[data-jail]")), 15000);
  const gone = await until(async () => !(await show.evaluate(() => window.__broadcastShown?.().jailCell ?? null)) && !/· in the cell/.test(await text()), 30000);
  check("3. bail paid: on the broadcast the cell goes", !!gone);
  const bailNews = await until(async () => /paid bail and walked out of the cell/.test(await text()), 20000);
  check("…and the news: they paid bail and walked out", !!bailNews);
  await show.screenshot({ path: `${OUT}/broadcast-jail-2-out.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("idle_arrests").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
