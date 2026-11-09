// The vulcanizer on the broadcast (owner, 9 Nov 2026: "The vulcanizer, following you back to the vehicle, should be
// implemented too"). A hunter's motorbike stands at the roadside with a flat, about a kilometre off; they've brought the
// vulcanizer (Baba Tunde) back with them, and walk to it by themselves (a phone, its own browser). The owner's broadcast
// follows them (a laptop, its own browser): Baba Tunde walks a few metres behind them along their way, as on their own
// screen, and their name on the map says so; once he's done (the flat changed), he's gone there too.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-vulcanizer-browser-test.mjs
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
const start = { lng: 3.3787, lat: 6.5186 }; // a road in Yaba
const bike = { lng: 3.3862, lat: 6.5285 }; // the motorbike, ~1.4 km on
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const HELPER = "Baba Tunde";
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bvulc-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const name = `Rider${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true, coins: 500 }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  // The motorbike with a flat at the roadside, the vulcanizer walking back with them
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "motorbike", lng: bike.lng, lat: bike.lat, in_use: false, fuel: 80, tyre: 0, engine: 100, light: true, helmet: true, registered: true, insured: true,
    stranded_at: ago(120), flat_helper: HELPER });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast vulcanizer test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60), guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 }); // (the riddle answered: free to move)
  await admin.from("road_events").insert({ user_id: hunter.id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

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
  await wait(20000);
  // Walking to the motorbike by themselves
  await game.evaluate((t) => {
    const m = window.__lootaMap;
    m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
  }, bike);
  let moving = false;
  for (let i = 0; i < 120 && !moving; i++) { await wait(500); moving = ((await game.evaluate(() => window.__lootaPos?.().v ?? 0)) > 1); }
  await game.screenshot({ path: `${OUT}/broadcast-vulcanizer-0-game.png` });
  check("the hunter walks to their motorbike with the vulcanizer (their screen)", moving, moving ? "" : (await game.evaluate(() => document.body.innerText.slice(0, 400))).replace(/s+/g, " "));
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);

  // On the broadcast: Baba Tunde behind them
  const state = () => show.evaluate((id) => { const b = window.__broadcastShown?.(); return b ? { me: b[id] ? { lng: b[id].lng, lat: b[id].lat } : null, helper: b.helper } : null; }, hunter.id);
  let s = null;
  for (let i = 0; i < 40 && !s?.helper; i++) { await wait(500); s = await state(); }
  check("on the broadcast: the vulcanizer with them", s?.helper?.name === HELPER, JSON.stringify(s?.helper));
  // Where the hunter is drawn, every frame, and the vulcanizer every 400 ms: he should stand where they were a moment before
  const path = [];
  const track = show.evaluate((id) => new Promise((done) => {
    const out = [];
    const t0 = performance.now();
    const step = (t) => { const b = window.__broadcastShown?.(); if (b?.[id]) out.push({ lng: b[id].lng, lat: b[id].lat }); if (t - t0 < 18000) requestAnimationFrame(step); else done(out); };
    requestAnimationFrame(step);
  }), hunter.id);
  // (from once they are walking on the broadcast too: it plays a few seconds behind)
  for (let i = 0; i < 30; i++) { const a = await state(); await wait(500); const b = await state(); if (a?.me && b?.me && metres(a.me, b.me) > 2) break; }
  await wait(3000);
  const seen = [];
  for (let i = 0; i < 16; i++) {
    const x = await state();
    if (x?.me && x.helper) seen.push({ me: x.me, helper: x.helper, gap: metres(x.me, x.helper) });
    await wait(400);
  }
  path.push(...(await track));
  // On their way: within 1.5 m of a spot they were drawn at
  const behind = seen.filter((x) => path.some((p) => metres(p, x.helper) < 1.5)).length;
  const gaps = seen.map((x) => x.gap);
  const walked = seen.length > 1 ? metres(seen[0].helper, seen.at(-1).helper) : 0;
  check("…walking a few metres behind them, along their way", seen.length >= 12 && behind === seen.length && Math.max(...gaps) - Math.min(...gaps) < 3 && Math.max(...gaps) < 45, // (steady; people are drawn ~12x enlarged, so this is a body length or two on screen, as in the game)
    `${seen.length} looks, behind in ${behind}; ${Math.min(...gaps).toFixed(1)}–${Math.max(...gaps).toFixed(1)} m back`);
  check("…keeping up as they go", walked > 20, `${walked.toFixed(0)} m in ${((seen.length - 1) * 0.4).toFixed(1)} s`);
  await show.screenshot({ path: `${OUT}/broadcast-vulcanizer-1.png` });
  const label = await show.evaluate(() => [...document.querySelectorAll(".loota-hunter-marker .name")].map((e) => e.textContent).join(" | "));
  check("…their name on the map says so", /🧰/.test(label), label);

  // The flat changed: the vulcanizer goes (on the broadcast a few seconds later)
  await admin.from("player_vehicles").update({ flat_helper: null }).eq("user_id", hunter.id);
  let gone = null;
  for (let i = 0; i < 40; i++) { await wait(500); gone = await state(); if (!gone?.helper) break; }
  check("done: the vulcanizer goes on the broadcast too", !!gone && !gone.helper);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  if (huntId) {
    await admin.from("road_events").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
