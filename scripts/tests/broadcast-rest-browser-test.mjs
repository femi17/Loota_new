// Resting on the broadcast (owner, 14 Nov 2026: "When a user is resting, that they sit on the road the broadcast doesnt
// have that"). A tired hunter on their bicycle, in a live test hunt, followed on the owner's broadcast: "Rest here" →
// on the broadcast they sit at the roadside (off the road), the bicycle on its stand, "resting" by their name; they ride
// on → up again, the bicycle with them.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-rest-browser-test.mjs
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
  const email = `brest-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "bicycle", energy: 45, updated_at: ago(20) });
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "bicycle", lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast rest test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
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
  // Tired: rest right here
  const restBtn = await until(() => game.evaluate(() => { const b = document.querySelector('button[aria-label^="Sit down and rest right here"], button[aria-label^="Rest at "]'); if (b && !b.disabled) { b.click(); return b.getAttribute("aria-label"); } return null; }), 60000, 1000);
  if (!restBtn) console.log("DEBUG", JSON.stringify(await game.evaluate(() => ({ pos: window.__lootaPos?.(), buttons: [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).slice(0, 40) }))));
  check("tired on their bicycle: rest", !!restBtn, restBtn ?? "");
  const since = await until(async () => (await admin.from("player_positions").select("resting_since").eq("user_id", hunter.id).single()).data?.resting_since ?? null, 20000, 500);
  check("…resting (the server's word)", !!since, since);
  const sat = await until(() => show.evaluate((id) => { const s = window.__broadcastShown?.(); const label = [...document.querySelectorAll(".name")].map((e) => e.textContent).find((t) => /resting/.test(t ?? "")); return s?.seat && s.restBike && label ? { seat: s.seat, at: s[id], label } : null; }, hunter.id), 40000, 500);
  check("on the broadcast: sitting at the roadside, the bicycle on its stand, \"resting\" by their name", !!sat && metres(sat.seat, sat.at) > 2, sat ? `${Math.round(metres(sat.seat, sat.at))} m off the road · ${sat.label}` : "");
  await show.screenshot({ path: `${OUT}/broadcast-rest.png` });
  // They ride on
  await game.evaluate((t) => { const m = window.__lootaMap; m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } }); }, targets[0]);
  const up = await until(() => show.evaluate(() => { const s = window.__broadcastShown?.(); const label = [...document.querySelectorAll(".name")].some((e) => /resting/.test(e.textContent ?? "")); return s && !s.restBike && !label ? true : null; }), 60000, 500);
  check("…they ride on: up again, the bicycle with them", !!up);
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
