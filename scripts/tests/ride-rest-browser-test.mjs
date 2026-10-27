// Rest on a ride (owner, 27 Oct 2026: "on 5% … I get on the plane or any, the health should start from 5% but can begin
// to increase because they are in a rest mode"), on a phone: a hunter on 5% boards a bus; the energy shown climbs during
// the wait and the ride; off the bus, it carries on from there (the server agrees: no jump back down after the next
// save). The trip and test player are deleted.
//   SHOTS=<folder> node scripts/tests/ride-rest-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const home = { lng: 3.3787, lat: 6.5186 }; // Club Rd, Yaba
const to = { lng: 3.3787, lat: 6.5286 };

try {
  const email = `riderest-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "walk", energy: 5, updated_at: new Date().toISOString() });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const { error } = await admin.from("transit_trips").insert({
    user_id: id, mode: "bus", from_name: "Here", to_name: "There", to_lng: to.lng, to_lat: to.lat,
    path: [[home.lng, home.lat], [to.lng, to.lat]], path_m: 1100, fare: 0, departs_at: soon(20), arrives_at: soon(80), ride_s: 60,
  });
  if (error) throw error;
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
  const shown = () => page.evaluate(() => Number(/Energy (\d+)/.exec(document.querySelector('[aria-label^="Energy "]')?.getAttribute("aria-label") ?? "")?.[1] ?? NaN));
  await wait(8000);
  const start = await shown();
  check("waiting at the stop on 5%", start <= 8, `${start}`);
  await wait(40000);
  const mid = await shown();
  check("…the energy climbs during the wait and the ride", mid >= start + 8, `${start} → ${mid}`);
  let off = false;
  for (let i = 0; i < 60 && !off; i++) {
    await wait(1000);
    const { data: trip } = await admin.from("transit_trips").select("ended_at, outcome").eq("user_id", id).single();
    off = trip?.outcome === "arrived";
  }
  await wait(1500);
  check("off the bus", off);
  const landed = await shown();
  check("…still the energy from the ride", landed >= mid, `${landed}`);
  // Walk a little: the next save is the server's count. It mustn't drop back towards 5%.
  await page.keyboard.down("ArrowUp");
  await wait(6000);
  await page.keyboard.up("ArrowUp");
  await wait(3000);
  const after = await shown();
  const { data: pos } = await admin.from("player_positions").select("energy").eq("user_id", id).single();
  check("…walking on, it carries on from there (no jump back down)", after >= landed - 5 && pos.energy >= landed - 5, `shown ${after}, server ${Math.round(pos.energy)}`);
  await page.screenshot({ path: `${OUT}/ride-rest.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`trip and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
