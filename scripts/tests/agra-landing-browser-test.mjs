// Landing at Agra (owner, 11 Nov 2026: "I landed at an airport, and a random line was drawn that the avatar cannot even
// pass, it was just walking back and forth… use the path around the airport that leads to the main road"). A hunter
// flies to the Taj Mahal and lands at Agra Airport (an air force station: the airfield's own roads, the public road
// some way off), as the owner did; on landing the rest of the way, 8 km east, is mapped by itself. Watched for a minute:
//   1. put onto a road that leads somewhere, not the airfield;
//   2. the way to the Taj Mahal is drawn, and it starts where the hunter stands (not across a fence);
//   3. the hunter gets on: further from the airport as the minute goes, never pacing one stretch back and forth,
//      never told "Head back to the blue line" or "You left the route" over and over.
// The trip and the test player are deleted.   SHOTS=<folder> node scripts/tests/agra-landing-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const lagos = { lng: 3.321139, lat: 6.579119 };
const agra = { lng: 77.961025, lat: 27.157975 }; // the airport's point, as the owner's flight had it
const taj = { lng: 78.0421, lat: 27.1751 };

try {
  const email = `agra-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: lagos.lng, home_lat: lagos.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: lagos.lng, lat: lagos.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const { data: trip, error } = await admin.from("transit_trips").insert({
    user_id: id, mode: "plane", from_name: "Murtala Mohammed International Airport", to_name: "Agra Airport / Agra Air Force Station",
    to_lng: agra.lng, to_lat: agra.lat, path: [[lagos.lng, lagos.lat], [agra.lng, agra.lat]], path_m: 8_700_000, fare: 0,
    departs_at: ago(3600), arrives_at: soon(12), ride_s: 3612,
  }).select("id").single();
  if (error) throw error;
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  // Where they were headed after landing, as their game keeps it for the flight
  await page.evaluateOnNewDocument((uid, tripId, then) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); localStorage.setItem(`loota:ride:${tripId}`, JSON.stringify({ label: "Agra", then })); } catch {} }, id, trip.id, { id: "taj", name: "the Taj Mahal", lng: taj.lng, lat: taj.lat, kind: "landmark" });
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const text = () => page.evaluate(() => document.body.innerText).catch(() => ""); // (the dev server may reload the page once while it builds)
  const road = () => page.evaluate(() => window.__lootaRoad?.() ?? null).catch(() => null);
  const pos = () => page.evaluate(() => window.__lootaPos?.() ?? null).catch(() => null);

  let landed = false;
  for (let i = 0; i < 120 && !landed; i++) { await wait(500); landed = /Landed at Agra/.test(await text()) || (!(await page.evaluate(() => window.__lootaRide?.() ?? null).catch(() => 1)) && !!(await road())); } // (the message can pass between looks: off the plane and on a road is landed)
  check("landed at Agra", landed);
  let r = null;
  for (let i = 0; i < 45; i++) { await wait(1000); r = await road(); if (r && r.pocket === 0) break; }
  check("1. put onto a road that leads somewhere, not the airfield", r?.pocket === 0, JSON.stringify(r));
  await page.screenshot({ path: `${OUT}/agra-1-landed.png` });

  // The rest of the way, mapped by itself on landing
  let drawn = null;
  for (let i = 0; i < 40 && !drawn; i++) {
    await wait(1000);
    drawn = await page.evaluate(() => {
      const w = window.__lootaTrip?.();
      return w && w.coords.length > 1 ? { first: w.coords[0], last: w.coords[w.coords.length - 1], points: w.coords.length } : null;
    }).catch(() => null);
  }
  const way = drawn ? await page.evaluate(() => window.__lootaTrip?.() ?? null).catch(() => null) : null;
  if (way) {
    // Where the drawn way leaves the roads the hunter can walk (within the roads loaded around them)
    const far = way.off.map((d, i) => [i, d]).filter(([, d]) => d !== null && d > 25);
    const judged = way.off.filter((d) => d !== null).length;
    console.log(`  (the way: ${way.coords.length} points, ${Math.round(way.total)} m; ${far.length} of the ${judged} near the hunter over 25 m from a walkable road${far.length ? `: first at point ${far[0][0]} (${far[0][1]} m off), e.g. ${JSON.stringify(far.slice(0, 6))}` : ""}; starts ${Math.round(metres({ lng: way.coords[0][0], lat: way.coords[0][1] }, way.here))} m from the hunter)`);
  }
  const at0 = await pos();
  const startOff = drawn && at0 ? metres({ lng: drawn.first[0], lat: drawn.first[1] }, at0) : null;
  check("2. the way to the Taj Mahal is drawn", !!drawn, drawn ? `${drawn.points} points` : (await text()).match(/[^\n]*(route|way|road)[^\n]*/i)?.[0]);
  check("…and it starts where the hunter stands", startOff !== null && startOff < 40, startOff === null ? "no line" : `starts ${Math.round(startOff)} m from them`);

  // A minute on the way
  const trail = [];
  const said = { back: 0, left: 0 };
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    const p = await pos();
    if (p) trail.push({ t: Date.now() - t0, ...p });
    const tx = await text();
    if (/Head back to the blue line/.test(tx)) said.back++;
    if (/You left the route/.test(tx)) said.left++;
    await wait(1000);
  }
  await page.screenshot({ path: `${OUT}/agra-2-minute.png` });
  const far = (p) => metres(p, agra);
  const gained = trail.length ? far(trail[trail.length - 1]) - far(trail[0]) : 0;
  const spreadM = trail.length ? Math.max(...trail.map((p) => metres(p, trail[0]))) : 0;
  // Pacing: back and forth along one stretch leaves the hunter within a small circle while walking the whole time
  const walked = trail.slice(1).reduce((s, p, i) => s + metres(p, trail[i]), 0);
  const pacing = walked > 150 && spreadM < 120;
  check("3. a minute on: further from the airport, not pacing one stretch", gained > 200 && !pacing, `${Math.round(gained)} m further from the airport; walked ${Math.round(walked)} m within a ${Math.round(spreadM)} m circle`);
  check("…never told to head back or that they left the route, over and over", said.back < 5 && said.left < 2, `"Head back" ${said.back}×, "left the route" ${said.left}×`);
  const last = trail[trail.length - 1];
  const toTaj = last ? metres(last, taj) : null;
  console.log(`  (after a minute: ${last ? `${Math.round(far(last))} m from the airport, ${Math.round(toTaj)} m from the Taj Mahal, on ${last.mode}` : "no position"})`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`trip and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
