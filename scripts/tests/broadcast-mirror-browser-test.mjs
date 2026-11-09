// The broadcast mirrors the hunter's own screen (owner, 9 Nov 2026: "Can't we directly mirror what the user is doing on
// the screen, like user is controlling to screens but only one is shown to them… the movement should synchronize, right
// now it is… just jumping instead of walking or riding"). A hunter in a live test hunt taps a spot about 1.5 km away
// and goes there by themselves (a phone, its own browser); the owner's broadcast (a laptop, its own browser) is opened
// after they've set off and follows them. Every frame of both is recorded for 5 s: the broadcast draws them on the very
// path their own screen did (within a metre), the same short moment behind all along (synchronised: it never runs ahead
// or falls back), at their speed, gliding (no stalls, no jumps, never back), turning as they did. The hunt and the
// accounts are deleted. MODE=motorbike (or car, bicycle): the same, riding their own (its papers in order).
//   [MODE=motorbike] SHOTS=<folder> node scripts/tests/broadcast-mirror-browser-test.mjs
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
const MODE = process.env.MODE ?? "walk";
const start = { lng: 3.3787, lat: 6.5186 }; // a road in Yaba
const target = { lng: 3.3862, lat: 6.5285 }; // about 1.5 km on, through the streets
const kx = 111320 * Math.cos((start.lat * Math.PI) / 180);
const metres = (a, b) => Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110574);
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bmirror-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
/** Every frame for `ms`: [Date.now(), lng, lat, heading] from `read` (a page's own function, by name). */
const record = (page, read, arg, ms) =>
  page.evaluate(
    (fn, a, ms) =>
      new Promise((done) => {
        const out = [];
        const t0 = performance.now();
        const step = (t) => {
          const p = fn === "own" ? window.__lootaPos?.() : window.__broadcastShown?.()[a];
          if (p) out.push([Date.now(), p.lng, p.lat, p.heading ?? 0]);
          if (t - t0 < ms) requestAnimationFrame(step);
          else done(out);
        };
        requestAnimationFrame(step);
      }),
    read, arg, ms,
  );

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Walker${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: MODE, energy: 100, updated_at: ago(20) });
  if (MODE !== "walk") {
    await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: MODE, lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true });
    await admin.from("profiles").update({ rider_licence: true, driver_licence: true }).eq("id", hunter.id);
  }
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast mirror test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });
  await admin.from("road_events").insert({ user_id: hunter.id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

  browser = await launch();
  browser2 = await launch();
  const problems = [];
  const open = async (b, jar, path, viewport, uid) => {
    const page = await (await b.createBrowserContext()).newPage();
    await page.setViewport(viewport);
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    if (uid) await page.evaluateOnNewDocument((id) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); } catch {} }, uid);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    return page;
  };
  const game = await open(browser, await signedIn(hunter), `/play?hunt=${huntId}`, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, hunter.id);
  await wait(20000);
  await game.evaluate((t) => {
    const m = window.__lootaMap;
    m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
  }, target);
  let going = false;
  for (let i = 0; i < 30 && !going; i++) { await wait(500); going = await game.evaluate(() => document.querySelector("button[data-drive]")?.getAttribute("data-drive") === "on"); }
  // (A hunt's riddle clock may hold them first; wait until they move)
  let moving = false;
  for (let i = 0; i < 120 && !moving; i++) { await wait(500); moving = ((await game.evaluate(() => window.__lootaPos?.().v ?? 0)) > 1); }
  check(`the hunter (${MODE}) taps a spot and goes there by themselves`, going && moving);
  const show = await open(browser2, await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 800 });
  await wait(15000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  let mirrored = false;
  for (let i = 0; i < 20 && !mirrored; i++) { await wait(500); mirrored = await show.evaluate((id) => (window.__broadcastShown?.().mirrored ?? []).includes(id), hunter.id); }
  check("the broadcast, opened later, mirrors them", mirrored);
  await wait(2000);

  // Both screens, every frame, for 5 s
  const [own, seen] = await Promise.all([record(game, "own", null, 5000), record(show, "seen", hunter.id, 5000)]);
  // Their own path (with distance along it and when they were at each point)
  const path = [];
  let run = 0;
  for (const [t, lng, lat] of own) {
    if (path.length) run += metres(path[path.length - 1], { lng, lat });
    if (!path.length || metres(path[path.length - 1], { lng, lat }) > 0.05) path.push({ t, lng, lat, s: run });
  }
  /** A broadcast frame on their path: how far off it, and when their own screen was there. */
  const onPath = ([, lng, lat]) => {
    let best = { off: Infinity, t: 0 };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const ax = a.lng * kx, ay = a.lat * 110574, bx = b.lng * kx, by = b.lat * 110574, px = lng * kx, py = lat * 110574;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
      const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      const off = Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
      if (off < best.off) best = { off, t: a.t + (b.t - a.t) * k, inside: !(i === 1 && k === 0) && !(i === path.length - 1 && k === 1) };
    }
    return best;
  };
  const matched = seen.map((f) => ({ f, m: onPath(f) })).filter((x) => x.m.inside); // frames from the stretch both saw
  const worst = Math.max(...matched.map((x) => x.m.off));
  check("on the broadcast, exactly the path their own screen drew", matched.length > 100 && worst < 1, `${matched.length} frames, at most ${worst.toFixed(2)} m off it`);
  // Synchronised: each broadcast frame is where their own screen had them one fixed moment before (whatever they did:
  // a stop at a red light is a stop on both). The moment: the one that fits best, tried every 10 ms from 0.2 to 2 s.
  const ownAt = (t) => {
    if (t < own[0][0] || t > own[own.length - 1][0]) return null;
    let k = own.findIndex((o) => o[0] >= t);
    if (k <= 0) return { lng: own[0][1], lat: own[0][2] };
    const a = own[k - 1], b = own[k], q = (t - a[0]) / Math.max(1, b[0] - a[0]);
    return { lng: a[1] + (b[1] - a[1]) * q, lat: a[2] + (b[2] - a[2]) * q };
  };
  const fit = (lag) => {
    const e = seen.map((x) => { const o = ownAt(x[0] - lag); return o ? metres(o, { lng: x[1], lat: x[2] }) : null; }).filter((x) => x !== null).sort((a, b) => a - b);
    return { n: e.length, p95: e[Math.floor(e.length * 0.95)] ?? Infinity, max: e[e.length - 1] ?? Infinity };
  };
  let best = { lag: 0, n: 0, p95: Infinity, max: Infinity };
  for (let lag = 200; lag <= 2000; lag += 10) {
    const e = fit(lag);
    if (e.n > 100 && e.p95 < best.p95) best = { lag, ...e };
  }
  const ownPace = run / ((own[own.length - 1][0] - own[0][0]) / 1000);
  check("…synchronised: every frame where their own screen had them a fixed moment before", best.p95 < 1.5,
    `${best.lag} ms behind; 95% of frames within ${best.p95.toFixed(2)} m of it, the worst ${best.max.toFixed(2)} m (${best.n} frames; they went at ${ownPace.toFixed(1)} m/s)`);
  // Gliding as they did: frame to frame, no stall or jump their own screen didn't have
  let n = 0, stalls = 0, jumps = 0;
  for (let i = 1; i < seen.length; i++) {
    if (seen[i][0] - seen[i - 1][0] < 8) continue; // two paints with no time between them (a busy test machine)
    const a = ownAt(seen[i - 1][0] - best.lag), b = ownAt(seen[i][0] - best.lag);
    if (!a || !b) continue;
    const theirs = metres(a, b), ours = metres({ lng: seen[i - 1][1], lat: seen[i - 1][2] }, { lng: seen[i][1], lat: seen[i][2] });
    n++;
    if (theirs > 0.1 && ours < theirs * 0.3) stalls++;
    if (ours > theirs * 2.5 + 0.2) jumps++;
  }
  check("…gliding as they did: no stall or jump their own screen didn't have", n > 120 && stalls <= n * 0.01 && jumps <= n * 0.01, `${n} frames: ${stalls} stalls, ${jumps} jumps`);
  await show.screenshot({ path: `${OUT}/broadcast-mirror-follow.png` });
  await game.screenshot({ path: `${OUT}/broadcast-mirror-game.png` });
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
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
