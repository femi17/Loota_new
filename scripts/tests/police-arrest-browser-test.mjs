// Caught after a police chase: arrested (owner, 13 Nov 2026: "They caught me as shown, but not persecution. I should be
// taking away with my vehicle parked on the road, and the police car - Like the ambulance takes me to the police
// station"). A hunter in a live test hunt on their motorbike, followed on the owner's broadcast: they ride through a
// checkpoint, then stop: caught (50 coins), arrested: the patrol car takes them to the police station, the cell there
// (5 min a star); the motorbike stays parked where they were caught, on their map and the broadcast. Bail: out. Back
// beside the motorbike: on it again.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/police-arrest-browser-test.mjs
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
const until = async (fn, ms = 20000, step = 300) => { for (let t = 0; t < ms; t += step) { const v = await fn(); if (v) return v; await wait(step); } return null; };
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const start = { lng: 3.3787, lat: 6.5186 };
const targets = [{ lng: 3.3560, lat: 6.5800 }, { lng: 3.4100, lat: 6.6000 }, { lng: 3.3300, lat: 6.4900 }];
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `parrest-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const name = `Runner${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true, coins: 1000 }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "motorbike", lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Police arrest test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The test key, far away.", category: "maths", area_lng: 3.45, area_lat: 6.58, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.58 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60), guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });

  browser = await launch();
  browser2 = await launch();
  const problems = [];
  const open = async (b, jar, path, viewport, uid) => {
    const page = await (await b.createBrowserContext()).newPage();
    await page.setViewport(viewport);
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    if (uid) await page.evaluateOnNewDocument((id, h) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); localStorage.setItem(`loota:riddle-seen:${h}`, "1"); } catch {} }, uid, huntId);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    return page;
  };
  const game = await open(browser, await signedIn(hunter), `/play?hunt=${huntId}`, { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, hunter.id);
  const show = await open(browser2, await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 720 });
  await until(() => game.evaluate(() => !!window.__lootaMap).catch(() => false), 120000, 1000);
  await wait(8000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  const clickText = (t) => game.evaluate((x) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((y) => y.textContent?.includes(x) && !y.disabled); b?.click(); return !!b; }, t);
  const chaseNow = () => game.evaluate(() => window.__lootaChase?.() ?? null).catch(() => null);
  let leg = 0;
  /** Riding somewhere, a checkpoint; they ride on through it: the chase. */
  async function rideThrough() {
    const to = targets[leg++ % targets.length];
    await game.evaluate((t) => { const m = window.__lootaMap; m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } }); }, to);
    await wait(3000);
    await admin.from("road_events").insert({ user_id: hunter.id, hunt_id: huntId, kind: "checkpoint", npc: "Officer Bello", question: { prompt: "What does a red traffic light mean?", choices: ["Go faster", "Stop", "Turn left only"], answer: 1 } });
    const rode = await until(() => clickText("Ride on"), 120000, 1000);
    if (!rode) throw new Error("the checkpoint never stopped them");
    return until(() => chaseNow().then((c) => (c?.cops?.length ? c : null)), 30000);
  }

  const c1 = await rideThrough();
  check("rode on through a checkpoint: the chase", !!c1 && c1.level === 1, JSON.stringify(c1));
  await game.evaluate(() => document.querySelector('button[data-drive="on"]')?.click()); // they stop
  const caughtAt = await until(async () => { const a = (await admin.from("idle_arrests").select("*").eq("user_id", hunter.id).maybeSingle()).data; return a ?? null; }, 60000, 500);
  const coins = (await admin.from("profiles").select("coins").eq("id", hunter.id).single()).data.coins;
  const bike = (await admin.from("player_vehicles").select("in_use, stranded_at, impounded_at, lng, lat, fuel").eq("user_id", hunter.id).single()).data;
  check("caught: 50 coins, arrested (★: 5 min in the cell)", !!caughtAt && caughtAt.reason === "chase" && caughtAt.remaining_s === 300 && Number(coins) === 950, `${caughtAt?.reason}, ${caughtAt?.remaining_s} s, ${coins} coins`);
  check("…the motorbike stays parked at the roadside where they were caught (not impounded)", !!bike.stranded_at && !bike.in_use && !bike.impounded_at && metres(bike, caughtAt) < 5, JSON.stringify(bike));
  const card = await until(() => game.evaluate(() => document.body.innerText).then((t) => (/Caught after a police chase/.test(t) ? t : null)), 20000, 500);
  check("…their screen: \"Caught after a police chase\", the motorbike parked", !!card && /parked at the roadside/.test(card));
  const taken = await until(async () => { const a = (await admin.from("idle_arrests").select("station, arrives_at, route").eq("user_id", hunter.id).single()).data; return a?.arrives_at ? a : null; }, 90000, 1000);
  check("…the police take them to a police station, along the road", !!taken, taken ? `${taken.station}, ${taken.route?.length ?? 0} points` : "");
  const showNote = await until(() => show.evaluate(() => window.__broadcastShown?.().care ?? null).then((n) => (/caught after a police chase/.test(n ?? "") ? n : null)), 40000, 500);
  check("…the broadcast: caught after a police chase, taken to the station", !!showNote, showNote);
  const carShown = await until(() => show.evaluate(() => window.__broadcastShown?.().policeCar ?? null), 30000, 500);
  check("…the patrol car on the broadcast", !!carShown);
  const parkedShown = await until(() => show.evaluate(() => window.__broadcastShown?.().parked ?? null), 20000, 500);
  check("…the motorbike at the roadside on the broadcast (PARKED)", !!parkedShown && /\|left$/.test(parkedShown.key), JSON.stringify(parkedShown));
  await show.screenshot({ path: `${OUT}/arrest-broadcast.png` });
  const inCell = await until(() => game.evaluate(() => document.querySelector("[data-jail-left]") ? document.body.innerText : null), Math.max(30000, Date.parse(taken?.arrives_at ?? 0) - Date.now() + 40000), 1000);
  check("…in the cell at the station", !!inCell && /Locked up/i.test(inCell));
  await game.screenshot({ path: `${OUT}/arrest-cell.png` });
  // Bail: out
  await game.evaluate(() => [...document.querySelectorAll("button")].find((b) => /bail/i.test(b.textContent ?? "") && !b.disabled)?.click());
  const out = await until(async () => { const a = (await admin.from("idle_arrests").select("bailed_at").eq("user_id", hunter.id).single()).data; return a?.bailed_at ?? null; }, 30000, 500);
  check("bail paid: out", !!out);
  await browser.close();
  browser = null;
  // Back beside the motorbike: on it again
  await admin.from("player_positions").update({ lng: bike.lng + 0.002, lat: bike.lat, mode: "walk", updated_at: ago(30) }).eq("user_id", hunter.id);
  const jar = await signedIn(hunter);
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [...jar].map(([n, value]) => ({ name: n, value })), setAll: () => {} } });
  const farTry = (await c.rpc("start_vehicle", { p_kind: "motorbike", p_lng: bike.lng + 0.002, p_lat: bike.lat, p_rent: false })).data;
  await admin.from("player_positions").update({ lng: bike.lng, lat: bike.lat, mode: "walk", updated_at: ago(30) }).eq("user_id", hunter.id);
  const back = (await c.rpc("start_vehicle", { p_kind: "motorbike", p_lng: bike.lng, p_lat: bike.lat, p_rent: false })).data;
  check("away from it: \"parked at the roadside\"; beside it: on again", farTry?.reason === "stranded" && farTry?.parked === true && back?.ok === true, `${JSON.stringify(farTry)} / ${JSON.stringify(back)}`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  if (huntId) {
    await admin.from("hunt_events").delete().eq("hunt_id", huntId);
    await admin.from("road_events").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("idle_arrests").delete().eq("user_id", id);
    await admin.from("police_chases").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
