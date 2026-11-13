// Flats (owner, 13 Nov 2026: "I just bought a new bike, and it already had a flat. Flat comes often for motorbike and car.
// Fix it. Also, when vehicle have flat, it doesnt show on the broadcast"). A hunter in a live test hunt on a new
// motorbike, followed on the owner's broadcast:
//   1. they ride a few km: the tyres wear a little and can't go flat while they're new;
//   2. worn tyres (below 40): "Tyres worn", and a mechanic's service gives new ones;
//   3. a puncture (the test makes it): the motorbike stops at the roadside; news on the broadcast, the motorbike there with
//      FLAT TYRE, and the note "… has a flat tyre".
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/flat-tyre-browser-test.mjs
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
  const email = `flat-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Flat tyre test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
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
  const vehicle = async () => (await admin.from("player_vehicles").select("tyre, in_use, stranded_at").eq("user_id", hunter.id).eq("kind", "motorbike").single()).data;
  const ride = (t) => game.evaluate((x) => { const m = window.__lootaMap; m.fire("click", { lngLat: x, point: m.project([x.lng, x.lat]), originalEvent: { target: m.getCanvas() } }); }, t);

  // 1. New tyres: wear, no flat
  await ride(targets[0]);
  const p0 = await game.evaluate(() => window.__lootaPos?.());
  await wait(40000);
  const p1 = await game.evaluate(() => window.__lootaPos?.());
  const v1 = await vehicle();
  check("1. a new motorbike ridden a while: no flat, the tyres only a little worn", v1.tyre > 90 && v1.tyre < 100 && v1.in_use && !v1.stranded_at, `${Math.round(metres(p0, p1))} m on the map, tyre ${v1.tyre?.toFixed(1)}`);

  // 2. Worn tyres
  await admin.from("player_vehicles").update({ tyre: 35 }).eq("user_id", hunter.id).eq("kind", "motorbike");
  const worn = await until(async () => /tyres are worn/i.test(await game.evaluate(() => document.body.innerText)), 40000, 500);
  check("2. worn tyres: told a mechanic's service gives new ones", !!worn);

  // 3. A puncture
  await admin.from("player_vehicles").update({ tyre: 0 }).eq("user_id", hunter.id).eq("kind", "motorbike");
  const stopped = await until(async () => { const v = await vehicle(); return v.stranded_at && !v.in_use ? v : null; }, 40000, 500);
  check("3. a puncture: the motorbike stops at the roadside", !!stopped);
  const news = (await admin.from("hunt_events").select("kind, text").eq("hunt_id", huntId).eq("user_id", hunter.id)).data ?? [];
  check("…news for the hunt", news.some((n) => n.kind === "road_flat" && /flat tyre/.test(n.text)), JSON.stringify(news));
  const parked = await until(() => show.evaluate(() => window.__broadcastShown?.().parked ?? null), 40000, 500);
  check("…on the broadcast: the motorbike at the roadside", !!parked && /motorbike/.test(parked.key) && /flat/.test(parked.key), JSON.stringify(parked));
  const note = await until(() => show.evaluate(() => window.__broadcastShown?.().care ?? null).then((n) => (/flat tyre/.test(n ?? "") ? n : null)), 20000, 500);
  check("…and the note", !!note, note);
  const ticker = await until(() => show.evaluate(() => document.body.innerText).then((t) => (/got a flat tyre/.test(t) ? true : null)), 20000, 500);
  check("…and the news line", !!ticker);
  await show.screenshot({ path: `${OUT}/flat-broadcast.png` });
  await game.screenshot({ path: `${OUT}/flat-game.png` });
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
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
