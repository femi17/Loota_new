// A straight street abroad (owner, 27 Oct 2026, cycling on Cowper Street, Palo Alto: "on a free and straight road no
// obstacle or dead end, and yet, when I move, it turns back, then turn back again acting as if both ends are dead"),
// on a phone, where the roads come from the map's tiles: cycling on from the owner's spot goes on along the street one
// way, and after turning round, the other way, past the tile edge just behind, never told the road ends. The test
// player and bicycle are deleted.
//   SHOTS=<folder> node scripts/tests/straight-road-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const cowper = { lng: -122.146009794487, lat: 37.4399811145393 }; // where the owner was, 30 m from a tile edge

try {
  const email = `straight-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: cowper.lng, home_lat: cowper.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 100, engine: 100, lng: cowper.lng, lat: cowper.lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: cowper.lng, lat: cowper.lat, mode: "bicycle", energy: 100, updated_at: new Date().toISOString() });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
  const where = () => page.evaluate(() => window.__lootaRoad?.() ?? null);

  // Ride on (↑) 15 s, noting every spot: steadily away, and never "the road ends".
  async function ride(tag, steps = 30) {
    const start = await where();
    let farthest = 0, ended = false, back = 0;
    await page.keyboard.down("ArrowUp");
    for (let i = 0; i < steps; i++) {
      await wait(500);
      const p = await where();
      const d = p && start ? metres(p, start) : 0;
      if (d < farthest - 5) back = Math.max(back, farthest - d);
      farthest = Math.max(farthest, d);
      ended ||= /This road ends here/.test(await page.evaluate(() => document.body.innerText));
    }
    await page.keyboard.up("ArrowUp");
    await wait(800);
    check(`${tag}: on along the street`, farthest > 40, `${Math.round(farthest)} m`);
    check(`${tag}: never turned back`, back === 0, back ? `${Math.round(back)} m back` : "");
    check(`${tag}: never told the road ends`, !ended);
    return start;
  }
  await ride("one way");
  await page.screenshot({ path: `${OUT}/straight-1.png` });
  // Turn round (↓) and ride the other way, past where it started and the tile edge 30 m behind it.
  await page.keyboard.press("ArrowDown");
  await wait(1200);
  await ride("the other way", 40);
  const end = await where();
  check("…past the start and the tile edge beyond it", end && metres(end, cowper) > 40, end ? `${Math.round(metres(end, cowper))} m from the start` : "");
  await page.screenshot({ path: `${OUT}/straight-2.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
