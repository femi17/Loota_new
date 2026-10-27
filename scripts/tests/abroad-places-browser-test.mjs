// Places abroad (owner, 27 Oct 2026, in the United States: "I cannot pump my tire at the gas station… when I pass bus
// signs on the map my bus icon is not lit up"), on a phone in Palo Alto, after its squares were filled from
// OpenStreetMap (fill-area-check.mts): on a bicycle with soft tyres at the Valero on El Camino the Pump button shows;
// at the bus stop at Embarcadero Road & Waverley Street the bus tool lights up gold. The test players and bicycles are
// deleted.
//   SHOTS=<folder> node scripts/tests/abroad-places-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

async function open(tag, at, bike) {
  const email = `${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  if (bike) await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 60, engine: 100, lng: at.lng, lat: at.lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: bike ? "bicycle" : "walk", energy: 100, updated_at: new Date().toISOString() });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
  return { page, problems };
}

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

  // ---- At the Valero, on a bicycle with soft tyres
  const valero = { lng: -122.149203, lat: 37.428191 };
  const a = await open("pump", valero, true);
  let pump = "";
  for (let i = 0; i < 20 && !pump; i++) {
    await wait(1000);
    pump = await a.page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent ?? "").find((t) => /Pump/.test(t)) ?? "");
  }
  check("at the Valero with soft tyres: Pump shows", /Pump/.test(pump), pump);
  await a.page.screenshot({ path: `${OUT}/abroad-1-pump.png` });
  check("no page errors", a.problems.length === 0, a.problems.join(" / "));
  await a.page.close();

  // ---- At a bus stop
  const stop = { lng: -122.14931, lat: 37.440382 }; // Embarcadero Road & Waverley Street
  const b = await open("busstop", stop, false);
  let label = "";
  for (let i = 0; i < 20 && !/Take a bus/.test(label); i++) {
    await wait(1000);
    label = await b.page.evaluate(() => document.querySelector('[data-tool="transit"]')?.getAttribute("aria-label") ?? "");
  }
  const lit = await b.page.evaluate(() => /bg-gold/.test(document.querySelector('[data-tool="transit"]')?.className ?? ""));
  check("at the bus stop: the bus tool lights up", /Take a bus/.test(label) && lit, label);
  await b.page.screenshot({ path: `${OUT}/abroad-2-bus.png` });
  check("no page errors", b.problems.length === 0, b.problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
