// Out from behind an airport's fence (owner, 27 Oct 2026: "I cannot leave the airport, I was dropped on a road that
// leads nowhere"), on a phone at San Francisco, where the roads come from the map's tiles: (1) a hunter standing on
// SFO's airside service road (no public access, joined to the town only by motorways a walker can't use) is put out
// onto a road that leads somewhere, and the server keeps it; (2) a hunter landing from Lagos ends up there too, not on
// the airfield. The trips and test players are deleted.
//   SHOTS=<folder> node scripts/tests/airside-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const airside = { lng: -122.390648895772, lat: 37.6265167160188 }; // by SFO Fire Station 1, where the owner was stuck
const sfo = { lng: -122.374821, lat: 37.619806 }; // the airport's point: the middle of the airfield
const lagos = { lng: 3.321139, lat: 6.579119 };

async function player(tag, at) {
  const email = `${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  return { id, jar };
}

async function open(p) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...p.jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, p.id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  return { page, problems };
}

/** Waits until the hunter is on a road that leads somewhere (not shut in), up to `s` seconds. */
async function outside(page, s) {
  let road = null;
  for (let i = 0; i < s; i++) {
    await wait(1000);
    road = await page.evaluate(() => window.__lootaRoad?.() ?? null);
    if (road && road.pocket === 0) break;
  }
  return road;
}
const savedAt = async (id) => (await admin.from("player_positions").select("lng, lat").eq("user_id", id).single()).data;

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

  // ---- (1) Standing on the airside road
  const stuck = await player("airside", airside);
  const a = await open(stuck);
  const road = await outside(a.page, 40);
  check("airside: put out onto a road that leads somewhere", road?.pocket === 0, JSON.stringify(road));
  const moved = road ? metres(road, airside) : Infinity;
  check("…a short walk away (within the 800 m the server allows)", moved > 30 && moved <= 800, `${Math.round(moved)} m`);
  await wait(4000);
  const kept = await savedAt(stuck.id);
  check("…and the server keeps it", road && metres(kept, road) < 40, `${Math.round(road ? metres(kept, road) : -1)} m from it`);
  await a.page.screenshot({ path: `${OUT}/airside-1-out.png` });
  check("no page errors", a.problems.length === 0, a.problems.join(" / "));
  await a.page.close();

  // ---- (2) Landing at San Francisco from Lagos
  const flyer = await player("landing", lagos);
  const { error } = await admin.from("transit_trips").insert({
    user_id: flyer.id, mode: "plane", from_name: "Murtala Mohammed International Airport", to_name: "San Francisco International Airport",
    to_lng: sfo.lng, to_lat: sfo.lat, path: [[lagos.lng, lagos.lat], [sfo.lng, sfo.lat]], path_m: 12_600_000, fare: 0,
    departs_at: ago(3600), arrives_at: soon(12), ride_s: 3612,
  });
  if (error) throw error;
  const b = await open(flyer);
  let landed = false;
  for (let i = 0; i < 60 && !landed; i++) {
    await wait(1000);
    landed = /Landed at San Francisco/.test(await b.page.evaluate(() => document.body.innerText));
  }
  check("landed at San Francisco", landed);
  const after = await outside(b.page, 45);
  check("landing: on a road that leads somewhere, not the airfield", after?.pocket === 0, JSON.stringify(after));
  const hop = after ? metres(after, sfo) : Infinity;
  check("…within the 3 km of the airport the server allows", hop <= 3000, `${Math.round(hop)} m`);
  await wait(5000);
  const there = await savedAt(flyer.id);
  check("…and the server keeps it", after && metres(there, after) < 60, `${Math.round(after ? metres(there, after) : -1)} m from it`);
  await b.page.screenshot({ path: `${OUT}/airside-2-landed.png` });
  check("no page errors", b.problems.length === 0, b.problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`trips and test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
