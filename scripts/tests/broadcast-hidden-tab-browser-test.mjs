// The hunter switches tab (owner, 12 Nov 2026: "on the user side, if user switch tab, the movement on the broadcast
// stops"). A hunter in a live test hunt sets off along a way (by themselves, as the game moves them), then another tab
// is brought in front of theirs: their tab is hidden and the browser stops its animation frames. Watched for 20 s:
//   1. their tab really is hidden;
//   2. they go on along the way at their pace (as far as in the 20 s before, give or take);
//   3. the broadcast shows them going on too (its hunter moves as far);
//   4. back on their tab, they go on as before.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-hidden-tab-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const ids = [];
let huntId = null, browser, browser2;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 }; // a road in Yaba
const target = { lng: 3.3862, lat: 6.5285 }; // 1.5 km on foot
const kx = 111320 * Math.cos((start.lat * Math.PI) / 180);
const metres = (a, b) => Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110574);
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bhidden-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const name = `Tabber${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Hidden tab test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });
  // (no roadside stops in the way of the measuring)
  await admin.from("road_events").insert({ user_id: hunter.id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

  browser = await launch();
  browser2 = await launch();
  const problems = [];
  const ctx = await browser.createBrowserContext();
  const game = await ctx.newPage();
  await game.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  game.on("pageerror", (e) => problems.push(e.message));
  await game.setCookie(...[...(await signedIn(hunter))].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await game.evaluateOnNewDocument((id) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); } catch {} }, hunter.id);
  await game.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  await game.evaluate((t) => {
    const m = window.__lootaMap;
    m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
  }, target);
  let moving = false;
  for (let i = 0; i < 120 && !moving; i++) { await wait(500); moving = ((await game.evaluate(() => window.__lootaPos?.().v ?? 0)) > 1); }
  check("the hunter sets off along the way", moving);

  const show = await (await browser2.createBrowserContext()).newPage();
  await show.setViewport({ width: 1280, height: 800 });
  show.on("pageerror", (e) => problems.push(e.message));
  await show.setCookie(...[...(await signedIn(owner))].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await show.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  let playing = false;
  for (let i = 0; i < 40 && !playing; i++) { await wait(500); playing = await show.evaluate((id) => (window.__broadcastShown?.().moving ?? []).includes(id), hunter.id); }
  check("the broadcast plays them going", playing);

  const own = () => game.evaluate(() => window.__lootaPos?.() ?? null);
  const seen = () => show.evaluate((id) => window.__broadcastShown?.()?.[id] ?? null, hunter.id);
  // 20 s on their tab, as a yardstick
  const a0 = await own(), s0 = await seen();
  await wait(20000);
  const a1 = await own(), s1 = await seen();
  const shownGo = metres(a0, a1), seenGo = s0 && s1 ? metres(s0, s1) : 0;

  // Another tab in front: theirs is hidden
  const other = await ctx.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await wait(1500);
  const state = await game.evaluate(() => document.visibilityState);
  const frames = await game.evaluate(() => new Promise((done) => { let n = 0; const t0 = Date.now(); const f = () => { n++; if (Date.now() - t0 < 1000) requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => done(n), 1200); }));
  check("1. another tab in front: theirs is hidden, its animation frames stopped", state === "hidden" && frames <= 2, `${state}, ${frames} frames in a second`);
  const b0 = await own(), t0 = await seen();
  await wait(20000);
  const b1 = await own(), t1 = await seen();
  const hiddenGo = metres(b0, b1), hiddenSeen = t0 && t1 ? metres(t0, t1) : 0;
  check("2. hidden, they go on along the way at their pace", hiddenGo > shownGo * 0.7, `${Math.round(hiddenGo)} m in 20 s hidden; ${Math.round(shownGo)} m in 20 s shown`);
  check("3. …and the broadcast shows them going on", hiddenSeen > seenGo * 0.6 && hiddenSeen > 20, `${Math.round(hiddenSeen)} m on the broadcast hidden; ${Math.round(seenGo)} m shown`);

  // Back on their tab
  await game.bringToFront();
  await wait(1500);
  const c0 = await own();
  await wait(10000);
  const c1 = await own();
  check("4. back on their tab, they go on as before", (await game.evaluate(() => document.visibilityState)) === "visible" && metres(c0, c1) > shownGo * 0.35, `${Math.round(metres(c0, c1))} m in 10 s`);
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
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
