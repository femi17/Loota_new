// Catching up along the roads on the broadcast (owner, 8 Nov 2026: "In an attempt for the avatar to catch up with the
// users avatar. They travel along a path, and is not the path, like crossing roads or walking on buildings"). The owner's
// broadcast follows a hunter in a live test hunt; the hunter's positions are sent as the game sends them: standing at a
// spot on one street, then, after a gap, round a corner on the next street (the straight line between the two crosses
// the block). Sampled while the broadcast catches up, the hunter is always on a road (within a few metres of one),
// never across the block. The hunt and the accounts are deleted.
//   SHOTS=<folder> node scripts/tests/broadcast-roads-browser-test.mjs
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
let huntId = null, browser, sender = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 }; // a road in Yaba
const user = async (tag) => {
  const email = `broads-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  return { jar, c };
};

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Corner${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast roads test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("pageerror", (e) => problems.push(e.message));
  const o = await signedIn(owner);
  await page.setCookie(...[...o.jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  await page.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  await wait(6000);

  // A street corner near the hunter, from the map's own roads: A on one street, B on the next, ~60 m from the corner
  // each, with the straight line between them well off any road (across the block).
  const corner = await page.evaluate((s) => {
    const map = window.__broadcastMap;
    if (!map) return { error: "no map" };
    const k = 111320 * Math.cos((s.lat * Math.PI) / 180);
    const xy = (c) => [(c[0] - s.lng) * k, (c[1] - s.lat) * 110574];
    const ll = (p) => [s.lng + p[0] / k, s.lat + p[1] / 110574];
    const lines = [];
    for (const f of map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" })) {
      if (!["minor", "tertiary", "secondary", "primary", "service"].includes(f.properties?.class)) continue;
      const g = f.geometry;
      const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      for (const p of parts) if (p.length >= 2) lines.push(p.map(xy));
    }
    const segDist = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-9)));
      return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
    };
    const offRoad = (p) => {
      let best = Infinity;
      for (const l of lines) for (let i = 1; i < l.length; i++) best = Math.min(best, segDist(p, l[i - 1], l[i]));
      return best;
    };
    // Walk `m` metres along a line from vertex i, one way or the other.
    const walk = (l, i, dir, m) => {
      let left = m, at = l[i];
      for (let j = i + dir; j >= 0 && j < l.length; j += dir) {
        const d = Math.hypot(l[j][0] - at[0], l[j][1] - at[1]);
        if (d >= left) return [at[0] + ((l[j][0] - at[0]) * left) / d, at[1] + ((l[j][1] - at[1]) * left) / d];
        left -= d;
        at = l[j];
      }
      return null;
    };
    const byKey = new Map();
    lines.forEach((l, li) => l.forEach((p, vi) => {
      const key = `${Math.round(p[0])},${Math.round(p[1])}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push([li, vi]);
    }));
    let found = null;
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      const j = lines[list[0][0]][list[0][1]];
      if (Math.hypot(j[0], j[1]) > 500) continue;
      const arms = [];
      for (const [li, vi] of list) for (const dir of [1, -1]) {
        const p = walk(lines[li], vi, dir, 60);
        if (p) arms.push(p);
      }
      for (let x = 0; x < arms.length && !found; x++) for (let y = x + 1; y < arms.length && !found; y++) {
        const a = arms[x], b = arms[y];
        const ang = Math.acos(((a[0] - j[0]) * (b[0] - j[0]) + (a[1] - j[1]) * (b[1] - j[1])) / (60 * 60));
        if (ang < (65 * Math.PI) / 180 || ang > (115 * Math.PI) / 180) continue;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const across = offRoad(mid);
        if (across > 25) found = { a: ll(a), b: ll(b), corner: ll(j), across: Math.round(across) };
      }
      if (found) break;
    }
    if (!found) return { error: `no corner found among ${lines.length} lines` };
    return found;
  }, start);
  if (corner.error) throw new Error(corner.error);
  console.log(`a corner: the straight line between the two spots passes ${corner.across} m from any road`);

  // The hunter's positions, as their game sends them on the hunt's channel.
  const h = await signedIn(hunter);
  sender = h.c.channel(`hunt:${huntId}`, { config: { broadcast: { self: false } } });
  await new Promise((resolve) => sender.subscribe((st) => st === "SUBSCRIBED" && resolve()));
  const send = (p) => sender.send({ type: "broadcast", event: "pos", payload: { id: hunter.id, lng: p[0], lat: p[1], mode: "walk", t: Date.now() } });
  for (let i = 0; i < 6; i++) {
    await send(corner.a);
    await wait(500);
  }
  await wait(1500);
  // Round the corner, after a gap: the broadcast catches up.
  await send(corner.b);
  const samples = [];
  for (let i = 0; i < 60; i++) {
    samples.push(await page.evaluate((id) => window.__broadcastShown?.()[id] ?? null, hunter.id));
    if (i % 10 === 9) await send(corner.b);
    await wait(50);
  }
  const off = await page.evaluate((list) => {
    const map = window.__broadcastMap;
    const lines = [];
    for (const f of map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" })) {
      const g = f.geometry;
      const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      for (const p of parts) if (p.length >= 2) lines.push(p);
    }
    return list.filter(Boolean).map((s) => {
      const k = 111320 * Math.cos((s.lat * Math.PI) / 180);
      const xy = (c) => [(c[0] - s.lng) * k, (c[1] - s.lat) * 110574];
      let best = Infinity;
      for (const l of lines) for (let i = 1; i < l.length; i++) {
        const a = xy(l[i - 1]), b = xy(l[i]);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, (-a[0] * dx - a[1] * dy) / (dx * dx + dy * dy || 1e-9)));
        best = Math.min(best, Math.hypot(a[0] + dx * t, a[1] + dy * t));
      }
      return best;
    });
  }, samples);
  const moved = samples.filter(Boolean);
  const reached = moved.length && Math.hypot((moved.at(-1).lng - corner.b[0]) * 110400, (moved.at(-1).lat - corner.b[1]) * 110574) < 8;
  const worst = Math.max(...off);
  check("catching up round the corner: on the roads all the way, never across the block", off.length > 40 && worst < 10, `farthest from a road ${worst.toFixed(1)} m (the straight line: ${corner.across} m)`);
  check("…and arrives where the hunter is", !!reached);
  await page.screenshot({ path: `${OUT}/broadcast-roads.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await sender?.unsubscribe();
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
