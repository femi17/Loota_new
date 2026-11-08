// Movement is automatic (owner, 8 Nov 2026: "When the route is drawn, let movement me auto… the avatar drives itself to
// the location"; "on the map, players should not steer but only make decisions"). On a phone-sized screen, a walker in
// free roam: no joystick and no Cruise on the map. A tap on the map draws the way, and the hunter goes along it by
// themselves, taking its turns (never far off the blue line). STOP stops them where they are; GO carries on. They
// arrive and the way ends. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/auto-drive-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const HOME = { lng: 3.3787, lat: 6.5186 }; // Yaba
const TARGET = { lng: 3.3812, lat: 6.5212 }; // ~400 m north-east, through the streets

async function until(page, fn, arg, ms = 30000) {
  for (let t = 0; t < ms; t += 400) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await wait(400); }
  return false;
}
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 110400, (a.lat - b.lat) * 110574);
/** How far a point is from a line of [lng, lat] points. */
function offLine(p, cs) {
  let best = Infinity;
  for (let i = 1; i < cs.length; i++) {
    const ax = cs[i - 1][0] * 110400, ay = cs[i - 1][1] * 110574, bx = cs[i][0] * 110400, by = cs[i][1] * 110574;
    const px = p.lng * 110400, py = p.lat * 110574;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}
const drive = (page) => page.evaluate(() => document.querySelector("button[data-drive]")?.getAttribute("data-drive") ?? null);

try {
  const email = `autodrive-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: HOME.lng, lat: HOME.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  // No road events in this test (one "just happened").
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(page, () => !!document.querySelector('[data-tool="directions"]') && !!window.__lootaRoad?.(), null, 60000);
  await wait(6000); // the roads around loaded
  // The Djinn's summons, if any, out of the way
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click());

  const bare = await page.evaluate(() => ({
    joystick: !!document.querySelector("[data-joystick]"),
    cruise: !!document.querySelector('button[aria-label^="Cruise"]'),
    drive: !!document.querySelector("button[data-drive]"),
  }));
  check("on the map: no joystick, no Cruise, no Stop/Go until a way is drawn", !bare.joystick && !bare.cruise && !bare.drive, JSON.stringify(bare));
  const start = await page.evaluate(() => window.__lootaPos());

  // A tap on the map, where the target is on screen
  const pt = await page.evaluate((t) => { const p = window.__lootaMap.project([t.lng, t.lat]); return { x: p.x, y: p.y }; }, TARGET);
  const onScreen = pt.x > 20 && pt.x < 370 && pt.y > 120 && pt.y < 700;
  if (onScreen) await page.touchscreen.tap(pt.x, pt.y);
  else await page.evaluate((t) => window.__lootaMap.fire("click", { lngLat: t, point: window.__lootaMap.project([t.lng, t.lat]), originalEvent: { target: window.__lootaMap.getCanvas() } }), TARGET);
  const routed = await until(page, () => /^To /m.test(document.querySelector('[aria-label="Directions"]')?.innerText ?? ""), null, 20000);
  const route = await page.evaluate(() => window.__lootaMap.getSource("route")?.serialize?.().data?.geometry?.coordinates ?? []);
  let turns = 0;
  for (let i = 2; i < route.length; i++) {
    const h1 = Math.atan2(route[i - 1][0] - route[i - 2][0], route[i - 1][1] - route[i - 2][1]);
    const h2 = Math.atan2(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    const d = Math.abs(((h2 - h1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (d > Math.PI / 4) turns++;
  }
  check("a tap on the map: the way is drawn", routed && route.length > 1, `${route.length} points, ${turns} turns${onScreen ? "" : " (clicked by the map's own event)"}`);
  const going = await until(page, () => document.querySelector("button[data-drive]")?.getAttribute("data-drive") === "on", null, 5000);
  check("…and the hunter sets off by themselves (STOP shows)", going, await drive(page));
  await page.screenshot({ path: `${OUT}/auto-drive-1-going.png` });

  // Along the way: never far off it
  let maxOff = 0, moved = 0, last = start, samples = 0;
  for (let i = 0; i < 8; i++) {
    await wait(1000);
    const p = await page.evaluate(() => window.__lootaPos());
    maxOff = Math.max(maxOff, offLine(p, route));
    moved += metres(last, p);
    last = p;
    samples++;
  }
  check("it moves along the way without a touch", moved > 60, `${Math.round(moved)} m in ${samples} s`);
  check("…on the blue line, turns and all", maxOff < 20, `at most ${Math.round(maxOff)} m off`);

  // STOP, then GO
  await page.evaluate(() => document.querySelector("button[data-drive]").click());
  await wait(1500);
  const a = await page.evaluate(() => window.__lootaPos());
  await wait(3000);
  const b = await page.evaluate(() => window.__lootaPos());
  check("STOP: stays where they are", metres(a, b) < 2 && (await drive(page)) === "off", `${metres(a, b).toFixed(1)} m, ${await drive(page)}`);
  await page.screenshot({ path: `${OUT}/auto-drive-2-stopped.png` });
  await page.evaluate(() => document.querySelector("button[data-drive]").click());
  await wait(3000);
  const c2 = await page.evaluate(() => window.__lootaPos());
  check("GO: carries on", metres(b, c2) > 15 && (await drive(page)) === "on", `${Math.round(metres(b, c2))} m`);

  // To the end
  const arrived = await until(page, () => /You've arrived at/.test(document.body.innerText) && !document.querySelector("button[data-drive]"), null, 90000);
  const end = await page.evaluate(() => window.__lootaPos());
  check("arrives, and the way ends (no Stop/Go left)", arrived && !(await page.evaluate(() => !!document.querySelector("button[data-drive]"))), `${Math.round(metres(end, TARGET))} m from the tap`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
