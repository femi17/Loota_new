// A flat on a motorbike, on the phone (owner, 22 Oct 2026: "Yes, fix with a jack"): riding in Yaba, a tyre goes flat
// (planted: the dice roll it about once in 100 km): the motorbike stops at the roadside and you're told; "🛞 Fix flat";
// the roadside mechanic offers to change it (40 coins); 25 s of work; back on the motorbike. With a jack, the scene
// offers to change it yourself, free. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/flat-tyre-browser-test.mjs
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
const NL = String.fromCharCode(10);
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 }; // on a road in Yaba

try {
  const email = `flat-ui-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ coins: 300, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", id);
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 80, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  // No road events in this test (one "just happened").
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, id);
  const shot = (name) => page.screenshot({ path: `${OUT}/flat-${name}.png` });
  const body = () => page.evaluate((nl) => document.body.innerText.split(nl).join(" | "), NL);
  const scene = () => page.evaluate((nl) => document.querySelector('[role="dialog"]')?.innerText.split(nl).join(" | ") ?? "", NL);
  const bike = async () => (await admin.from("player_vehicles").select("tyre, in_use, stranded_at").eq("user_id", id).single()).data;
  const coins = async () => Number((await admin.from("profiles").select("coins").eq("id", id).single()).data.coins);
  const tap = (x) => page.evaluate((s) => {
    const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.trim().includes(s) && !e.disabled);
    b?.click();
    return !!b;
  }, x);
  const tapWhenThere = async (x, tries = 30) => {
    for (let i = 0; i < tries; i++) {
      if (await tap(x)) return true;
      await wait(500);
    }
    return false;
  };
  /** Ride along until a flat (planted while riding) stops the motorbike. */
  const rideIntoFlat = async () => {
    await page.keyboard.down("ArrowUp");
    await wait(3000);
    await admin.from("player_vehicles").update({ tyre: 0 }).eq("user_id", id);
    let b = await bike();
    for (let i = 0; i < 30 && !b.stranded_at; i++) { await wait(1000); b = await bike(); }
    await page.keyboard.up("ArrowUp");
    await wait(2500);
    return b;
  };

  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);

  // ---- A flat on the road
  let b = await rideIntoFlat();
  check("a flat: the motorbike stops at the roadside", !!b.stranded_at && !b.in_use, JSON.stringify(b));
  const said = await body();
  check("…and you're told what to do", /Flat tyre! Your motorbike stands at the roadside/.test(said), said.match(/Flat tyre![^|]*/)?.[0]);
  await shot("1-flat");
  check("a 🛞 Fix flat button beside it", await tapWhenThere("Fix flat", 10));
  let s = "";
  for (let i = 0; i < 20 && !/change am for you/.test(s); i++) { await wait(500); s = await scene(); }
  check("a roadside mechanic offers to change it: 40 coins", /change am for you: 40 coins/.test(s), s.slice(0, 200));
  check("…no jack: no do-it-yourself", !/Change it myself/.test(s));
  await shot("2-mechanic");
  const before = await coins();
  check("let the mechanic do it", await tapWhenThere("Let the mechanic do it"));
  for (let i = 0; i < 70 && !/Safe journey/.test(s); i++) { await wait(500); s = await scene(); }
  b = await bike();
  check("…25 s later: done, and back on the motorbike", /Safe journey/.test(s) && b.tyre === 100 && b.in_use && !b.stranded_at, JSON.stringify(b));
  check("…40 coins paid", (await coins()) === before - 40, `${before} → ${await coins()}`);
  await shot("3-done");
  await tapWhenThere("Thank you");
  await wait(1500);

  // ---- With a jack
  await admin.from("player_vehicles").update({ jack: true }).eq("user_id", id);
  await page.goto("about:blank");
  await admin.from("player_positions").update({ updated_at: ago(20) }).eq("user_id", id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  b = await rideIntoFlat();
  check("another flat", !!b.stranded_at, JSON.stringify(b));
  await tapWhenThere("Fix flat", 10);
  s = "";
  for (let i = 0; i < 30 && !/Change it myself/.test(s); i++) { await wait(500); s = await scene(); }
  check("with a jack: change it yourself, free", /Change it myself \(jack\) · free/.test(s), s.slice(0, 220));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
