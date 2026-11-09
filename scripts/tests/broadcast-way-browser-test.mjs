// The broadcast on the hunter's own way (owner, 9 Nov 2026: "since the users moves on auto now, we should looke for users
// actions, so we can really align the avatar on the correct path. Right now, the walking still glitches, and the
// movement is always off the path"). A hunter in a live test hunt taps a spot about 1.5 km away and goes there by
// themselves (a phone); the owner's broadcast is opened after they've set off (a laptop), so the way reaches it by its
// re-sending. Sampled side by side: the broadcast draws them along their way (not guessing the roads), on that line
// (within a metre), never stepping back along it, where their own screen has them, at their speed. The hunt and the
// accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-way-browser-test.mjs
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
let huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 }; // a road in Yaba
const target = { lng: 3.3862, lat: 6.5285 }; // about 1.5 km on, through the streets
const kx = 111320 * Math.cos((start.lat * Math.PI) / 180);
const metres = (a, b) => Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110574);
/** Where a point is along a line of [lng, lat] points: metres along it, and how far off it. */
function along(p, pts) {
  let best = { s: 0, off: Infinity }, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0] * kx, ay = pts[i - 1][1] * 110574, bx = pts[i][0] * kx, by = pts[i][1] * 110574;
    const px = p.lng * kx, py = p.lat * 110574;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9, len = Math.sqrt(len2);
    const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const off = Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
    if (off < best.off) best = { s: run + k * len, off };
    run += len;
  }
  return best;
}
const user = async (tag) => {
  const email = `bway-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const name = `Walker${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast way test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });
  await admin.from("road_events").insert({ user_id: hunter.id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const open = async (jar, path, viewport, uid) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport(viewport);
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    if (uid) await page.evaluateOnNewDocument((id) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); } catch {} }, uid);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    return page;
  };
  const game = await open(await signedIn(hunter), `/play?hunt=${huntId}`, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, hunter.id);
  await wait(20000);
  // The hunter chooses where to go: a tap on the map (they go by themselves)
  await game.evaluate((t) => {
    const m = window.__lootaMap;
    m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
  }, target);
  let going = false;
  for (let i = 0; i < 30 && !going; i++) { await wait(500); going = await game.evaluate(() => document.querySelector("button[data-drive]")?.getAttribute("data-drive") === "on"); }
  check("the hunter taps a spot and sets off by themselves", going);
  // The owner opens the broadcast now, after they've set off
  const show = await open(await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 800 });
  await wait(15000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  let onWay = false;
  for (let i = 0; i < 40 && !onWay; i++) { await wait(500); onWay = await show.evaluate((id) => (window.__broadcastShown?.().onWay ?? []).includes(id), hunter.id); }
  check("opened later, the broadcast gets their way and draws them along it", onWay);
  const way = await show.evaluate((id) => window.__broadcastWay?.(id), hunter.id);

  // Side by side (the game in front: a page behind is held back by the browser)
  await game.bringToFront();
  const pairs = [];
  let nulls = { own: 0, seen: 0 };
  for (let i = 0; i < 48; i++) {
    const [own, seen] = await Promise.all([
      game.evaluate(() => window.__lootaPos?.() ?? null),
      show.evaluate((id) => window.__broadcastShown?.()[id] ?? null, hunter.id),
    ]);
    if (own && seen) pairs.push({ own, seen, t: Date.now() });
    if (!own) nulls.own++;
    if (!seen) nulls.seen++;
    await wait(250);
  }
  if (nulls.own || nulls.seen) console.log("   (not read: " + JSON.stringify(nulls) + ")");
  const offs = way ? pairs.map((p) => along(p.seen, way).off) : [Infinity];
  const worstOff = Math.max(...offs);
  check("on the broadcast, always on their way (the line they go along)", worstOff < 1.5, `at most ${worstOff.toFixed(2)} m off it`);
  const progress = way ? pairs.map((p) => along(p.seen, way).s) : [];
  let back = 0;
  for (let i = 1; i < progress.length; i++) back = Math.max(back, progress[i - 1] - progress[i]);
  check("…never stepping back along it", back < 1, `at most ${back.toFixed(2)} m back`);
  const apart = pairs.map((p) => metres(p.own, p.seen)).sort((x, y) => x - y);
  const typical = apart[Math.floor(apart.length / 2)] ?? Infinity;
  check("…where their own screen has them", pairs.length > 40 && typical < 8, `${typical.toFixed(1)} m apart (typical of ${pairs.length})`);
  const pace = (key) => {
    const a = pairs[2], b = pairs[pairs.length - 1];
    return a && b ? (along(b[key], way).s - along(a[key], way).s) / ((b.t - a.t) / 1000) : 0;
  };
  const ownPace = pace("own"), seenPace = pace("seen");
  check("…at their speed", ownPace > 5 && Math.abs(seenPace - ownPace) < ownPace * 0.15, `${seenPace.toFixed(1)} vs ${ownPace.toFixed(1)} m/s`);
  await show.screenshot({ path: `${OUT}/broadcast-way-follow.png` });
  await game.screenshot({ path: `${OUT}/broadcast-way-game.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
