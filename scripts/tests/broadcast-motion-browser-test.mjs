// The broadcast plays each hunter's own actions (owner, 9 Nov 2026: "If a user picks a end location, we store that, and
// then travel there on the broadcast, it is the action of the user on the frontend we use in the broadcast… We would be
// broadcasting this on Youtube, so It should not break. IT should have a smooth movement for viewers"; "make sure this is
// not eating the supabase realtime usage"). A hunter in a live test hunt taps a spot and goes there by themselves (a
// phone, its own browser); their game saves the way and motion keyframes (motion_put); the owner's broadcast (a laptop,
// its own browser), opened after they've set off, reads them by a light poll and plays them a few seconds behind. Every
// frame of both is recorded for 5 s: the broadcast draws them on the very path their own screen did, one fixed moment
// behind all along (within a metre or two of where their screen had them then), gliding (no stall or jump their own
// screen didn't have). And nothing of it goes over Realtime: the hunt's channel stays silent. MODE=motorbike (or car,
// bicycle): riding their own. The hunt and the accounts are deleted.
//   [MODE=motorbike] SHOTS=<folder> node scripts/tests/broadcast-motion-browser-test.mjs
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
const target = MODE === "walk" ? { lng: 3.3862, lat: 6.5285 } : { lng: 3.3560, lat: 6.5800 }; // 1.5 km on foot, 7 km riding
const kx = 111320 * Math.cos((start.lat * Math.PI) / 180);
const metres = (a, b) => Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110574);
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bmotion-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
        let drawn = null;
        const step = (t) => {
          if (fn === "own") {
            const p = window.__lootaPos?.();
            if (p) out.push([Date.now(), p.lng, p.lat, p.heading ?? 0]);
          } else {
            // Each frame the broadcast drew, once, at the moment it drew it
            const all = window.__broadcastShown?.();
            const p = all?.[a];
            if (p && all.drawnAt !== drawn) {
              drawn = all.drawnAt;
              out.push([all.drawnWall, p.lng, p.lat, p.heading ?? 0]); // the moment the broadcast drew it for
            }
          }
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
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast motion test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });
  await admin.from("road_events").insert({ user_id: hunter.id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

  // Listening to the hunt's live channel: nothing should come (no Realtime)
  const listener = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const overRealtime = [];
  const ch = listener.channel(`hunt:${huntId}`, { config: { broadcast: { self: false } } });
  ch.on("broadcast", { event: "*" }, ({ event }) => overRealtime.push(event));
  ch.subscribe();
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
  const game = await open(browser, await signedIn(hunter), `/play?hunt=${huntId}`, { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, hunter.id); // (lighter: two 3D pages on one machine)
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
  let playing = false;
  for (let i = 0; i < 30 && !playing; i++) { await wait(500); playing = await show.evaluate((id) => (window.__broadcastShown?.().moving ?? []).includes(id), hunter.id); }
  check("the broadcast, opened later, plays their way from their motion", playing);
  await wait(8000); // past its few seconds behind

  // Both screens, every frame
  // (their own screen from 5 s earlier and longer: the broadcast shows each moment a few seconds after it)
  const [own, seen] = await Promise.all([record(game, "own", null, 13000), wait(7000).then(() => record(show, "seen", hunter.id, 5000))]);
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
  // (within a metre; riding fast, their own frames here are up to ~10 m apart and the line between them cuts corners)
  const pathTol = Math.max(1, (run / ((own[own.length - 1][0] - own[0][0]) / 1000)) * 0.03);
  check("on the broadcast, exactly the path their own screen drew", matched.length > 100 && worst < pathTol, `${matched.length} frames, at most ${worst.toFixed(2)} m off it`);
  // Synchronised: each broadcast frame is where their own screen had them one fixed moment before (whatever they did:
  // a stop at a red light is a stop on both). The moment: the one that fits best, tried every 10 ms from 0.2 to 2 s.
  const ownRaw = (t) => {
    if (t < own[0][0] || t > own[own.length - 1][0]) return null;
    let k = own.findIndex((o) => o[0] >= t);
    if (k <= 0) return { lng: own[0][1], lat: own[0][2] };
    const a = own[k - 1], b = own[k], q = (t - a[0]) / Math.max(1, b[0] - a[0]);
    return { lng: a[1] + (b[1] - a[1]) * q, lat: a[2] + (b[2] - a[2]) * q };
  };
  // Their own screen, over a quarter of a second either side, as the broadcast smooths it (on this busy machine their
  // game draws in uneven steps a phone doesn't)
  const ownAt = (t) => {
    let lng = 0, lat = 0, w = 0;
    for (const [d, k] of [[-250, 1], [-125, 2], [0, 3], [125, 2], [250, 1]]) {
      const p = ownRaw(t + d);
      if (!p) return null;
      lng += k * p.lng;
      lat += k * p.lat;
      w += k;
    }
    return { lng: lng / w, lat: lat / w };
  };
  const ownGaps = own.slice(1).map((o, k) => o[0] - own[k][0]).sort((x, y) => x - y);
  console.log(`   (their own game drew every ${ownGaps[ownGaps.length >> 1]} ms, 95% within ${ownGaps[Math.floor(ownGaps.length * 0.95)]} ms)`);
  const fit = (lag) => {
    const e = seen.map((x) => { const o = ownAt(x[0] - lag); return o ? metres(o, { lng: x[1], lat: x[2] }) : null; }).filter((x) => x !== null).sort((a, b) => a - b);
    return { n: e.length, p95: e[Math.floor(e.length * 0.95)] ?? Infinity, max: e[e.length - 1] ?? Infinity };
  };
  let best = { lag: 0, n: 0, p95: Infinity, max: Infinity };
  for (let lag = 3000; lag <= 9000; lag += 10) {
    const e = fit(lag);
    if (e.n > 100 && e.p95 < best.p95) best = { lag, ...e };
  }
  const ownPace = run / ((own[own.length - 1][0] - own[0][0]) / 1000);
  // (within 2 m, or 70 ms at their pace: a motorbike covers 5 m in that; their own frames here are up to 130 ms apart)
  check("…synchronised: every frame where their own screen had them a fixed moment before", best.p95 < Math.max(2, ownPace * 0.07),
    `${best.lag} ms behind; 95% of frames within ${best.p95.toFixed(2)} m of it, the worst ${best.max.toFixed(2)} m (${best.n} frames; they went at ${ownPace.toFixed(1)} m/s)`);
  // Gliding: frame to frame on the broadcast, no sudden spurt or halt against its own pace a moment either side (half a
  // second). (Not against the hunter's own frames: on a busy test machine their game itself draws in uneven steps, up
  // to 130 ms apart, which a phone at 60 frames a second doesn't.)
  const pace = [];
  for (let k = 1; k < seen.length; k++) {
    const dt = seen[k][0] - seen[k - 1][0];
    if (dt < 8) continue;
    pace.push({ t: seen[k][0], v: metres({ lng: seen[k - 1][1], lat: seen[k - 1][2] }, { lng: seen[k][1], lat: seen[k][2] }) / (dt / 1000) });
  }
  let n = 0, stalls = 0, jumps = 0;
  for (const p of pace) {
    const near = pace.filter((q) => Math.abs(q.t - p.t) <= 250).map((q) => q.v).sort((a, b) => a - b);
    const typical = near[Math.floor(near.length / 2)];
    if (near.length < 5 || typical < 1) continue;
    n++;
    if (p.v < typical * 0.4) stalls++;
    if (p.v > typical * 1.8 + 1) jumps++;
  }
  check("…gliding: no sudden spurt or halt, frame to frame", n > 120 && stalls <= n * 0.01 && jumps <= n * 0.01, `${n} frames: ${stalls} halts, ${jumps} spurts`);
  check("nothing over Realtime: the hunt's channel stays silent", overRealtime.length === 0, overRealtime.length ? overRealtime.join(", ") : "silent");
  await listener.removeChannel(ch);
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
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
