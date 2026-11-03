// The broadcast and the hunter's own screen in step (owner, 3 Nov 2026: "make sure the user and the user on the
// broadcast synchronize. Same exact spot, same movement speed etc"), end to end: a hunter in a live test hunt walks
// in the game (a phone) while the owner's broadcast follows them (a laptop); sampled side by side, the broadcast draws
// them where their own screen does, at the same speed; and following them, the camera is the laptop's (zoom 17,
// tilt 60, behind them). The hunt and the accounts are deleted.
//   SHOTS=<folder> node scripts/tests/broadcast-sync-browser-test.mjs
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
const user = async (tag) => {
  const email = `bsync-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast sync test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });
  // No road events in this test (one "just happened").
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
  const show = await open(await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 800 });
  await wait(20000);
  // Follow the hunter on the broadcast.
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  // Walk, and sample both screens side by side.
  await game.bringToFront();
  await game.keyboard.down("ArrowUp");
  await wait(3000);
  const pairs = [];
  for (let i = 0; i < 40; i++) {
    const [own, seen] = await Promise.all([
      game.evaluate(() => window.__lootaPos?.() ?? null),
      show.evaluate((id) => window.__broadcastShown?.()[id] ?? null, hunter.id),
    ]);
    if (own && seen) pairs.push({ own, seen, t: Date.now() });
    await wait(250);
  }
  await game.keyboard.up("ArrowUp");
  const kx = 111320 * Math.cos((start.lat * Math.PI) / 180);
  const apart = pairs.map((p) => Math.hypot((p.own.lng - p.seen.lng) * kx, (p.own.lat - p.seen.lat) * 110574)).sort((x, y) => x - y);
  const typical = apart[Math.floor(apart.length / 2)] ?? Infinity;
  const pace = (key) => {
    const a = pairs[2], b = pairs[pairs.length - 1];
    return a && b ? Math.hypot((b[key].lng - a[key].lng) * kx, (b[key].lat - a[key].lat) * 110574) / ((b.t - a.t) / 1000) : 0;
  };
  const ownPace = pace("own"), seenPace = pace("seen");
  check("the hunter walks on their own screen", ownPace > 5, `${ownPace.toFixed(1)} m/s`);
  check("the broadcast draws them where their own screen does", pairs.length > 30 && typical < 8, `${typical.toFixed(1)} m apart (typical of ${pairs.length})`);
  check("…at the same speed", Math.abs(seenPace - ownPace) < ownPace * 0.15, `${seenPace.toFixed(1)} vs ${ownPace.toFixed(1)} m/s`);
  const camera = await show.evaluate(() => window.__broadcastShown?.() ?? null);
  check("following them: the laptop's zoom", camera && Math.abs(camera.zoom - 17) < 0.3, `zoom ${camera?.zoom?.toFixed(2)}`);
  await show.screenshot({ path: `${OUT}/broadcast-sync-follow.png` });
  await game.screenshot({ path: `${OUT}/broadcast-sync-game.png` });
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
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
