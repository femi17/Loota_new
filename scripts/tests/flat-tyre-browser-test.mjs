// A flat on a motorbike, on the phone. Nobody fixes tyres by the roadside (owner, 3 Nov 2026: "If you have flat, it is
// not right there you get a vulcanizer. You find one, and you do either one of the two thing, roll your tire to the
// vulcanizer, or you go to the vulcanizer, they come back with you to fix it"). Riding in Yaba, a tyre goes flat
// (planted): the motorbike stops at the roadside and the way to the nearest vulcanizer is drawn.
//   (1) Roll it: 🛞 Wheel off; at the vulcanizer (a petrol station's tyre man) 🛞 Fix tyre · 20, the patch in the
//       scene; back at the motorbike 🛞 Wheel on, and riding again.
//   (2) Bring them: at the vulcanizer 🧰 Vulcanizer · 40; they walk behind you; at the motorbike 🛞 Fix flat, they
//       change it (40 coins), and riding again.
//   (3) With a jack and spare: 🔧 Jack · free beside it, changed yourself.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/flat-tyre-browser-test.mjs
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
// Petrol station 7306 (its tyre man), down its driveway (scripts/tests/place-driveways-check.mts).
const vulcanizer = { lng: 3.385341, lat: 6.519144 };

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
  const bike = async () => (await admin.from("player_vehicles").select("tyre, in_use, stranded_at, flat_wheel, flat_helper, lng, lat").eq("user_id", id).single()).data;
  const coins = async () => Number((await admin.from("profiles").select("coins").eq("id", id).single()).data.coins);
  const buttons = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "").filter((t) => /Fix flat|Wheel|Jack|Fix tyre|Vulcanizer/.test(t)));
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
  const sceneUntil = async (re, tries = 60) => {
    let s = "";
    for (let i = 0; i < tries && !re.test(s); i++) { await wait(500); s = await scene(); }
    return s;
  };
  const openAt = async (at, mode = "walk") => {
    await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode, energy: 100, updated_at: ago(20) });
    await page.goto("about:blank");
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };
  /** Ride along until a flat (planted while riding) stops the motorbike. */
  const rideIntoFlat = async () => {
    await page.keyboard.down("ArrowUp");
    await wait(3000);
    await admin.from("player_vehicles").update({ tyre: 0 }).eq("user_id", id);
    let b = await bike();
    for (let i = 0; i < 30 && !b.stranded_at; i++) { await wait(1000); b = await bike(); }
    await page.keyboard.up("ArrowUp");
    await wait(4000);
    return b;
  };

  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);

  // ---- A flat on the road
  let b = await rideIntoFlat();
  check("a flat: the motorbike stops at the roadside", !!b.stranded_at && !b.in_use, JSON.stringify(b));
  let said = "";
  for (let i = 0; i < 20 && !/The nearest/.test(said); i++) { await wait(500); said = await body(); }
  check("…told to find a vulcanizer (none by the road), the nearest named", /No vulcanizer by the road: find one/.test(said) && /The nearest/.test(said), said.match(/No vulcanizer[^|]*/)?.[0]);
  let here = await buttons();
  check("…beside it: 🛞 Wheel off, no roadside mechanic, no jack", here.some((t) => /Wheel off/.test(t)) && !here.some((t) => /Fix flat|Jack/.test(t)), here.join(" / "));
  await shot("1-flat");
  const car = { lng: b.lng, lat: b.lat };

  // ---- (1) Roll it
  check("take the wheel off", await tapWhenThere("Wheel off", 10));
  for (let i = 0; i < 20 && b.flat_wheel !== "off"; i++) { await wait(500); b = await bike(); }
  check("…the wheel is off", b.flat_wheel === "off", JSON.stringify(b));
  await shot("2-wheel-off");
  await openAt(vulcanizer);
  here = await buttons();
  check("at the vulcanizer: 🛞 Fix tyre · 20 (no bringing them: the wheel is here)", here.some((t) => /Fix tyre · 20/.test(t)) && !here.some((t) => /Vulcanizer/.test(t)), here.join(" / "));
  await tapWhenThere("Fix tyre");
  let s = await sceneUntil(/pump your motorbike's tyre: 20 coins/);
  check("…the vulcanizer: patch it, 20 coins", /pump your motorbike's tyre: 20 coins/.test(s), s.slice(0, 200));
  let before = await coins();
  await tapWhenThere("Go ahead");
  s = await sceneUntil(/put it on\./, 80);
  b = await bike();
  check("…20 s later: patched, roll it back", /Roll it back to your motorbike/.test(s) && b.flat_wheel === "fixed", JSON.stringify(b));
  check("…20 coins paid", (await coins()) === before - 20, `${before} → ${await coins()}`);
  await shot("3-patched");
  await tapWhenThere("Thank you");
  await wait(2000);
  await openAt(car);
  here = await buttons();
  check("back at the motorbike: 🛞 Wheel on", here.some((t) => /Wheel on/.test(t)), here.join(" / "));
  await tapWhenThere("Wheel on");
  for (let i = 0; i < 20 && !b.in_use; i++) { await wait(500); b = await bike(); }
  check("…the tyre as new, and back on the motorbike", b.tyre === 100 && b.in_use && !b.stranded_at && !b.flat_wheel, JSON.stringify(b));

  // ---- (2) Bring them
  await admin.from("player_vehicles").update({ tyre: 0, in_use: false, stranded_at: new Date().toISOString(), lng: car.lng, lat: car.lat }).eq("user_id", id);
  await openAt(vulcanizer);
  here = await buttons();
  check("a flat, at the vulcanizer: 🧰 Vulcanizer · 40", here.some((t) => /Vulcanizer · 40/.test(t)), here.join(" / "));
  await tapWhenThere("Vulcanizer · 40");
  for (let i = 0; i < 20 && !b.flat_helper; i++) { await wait(500); b = await bike(); }
  check("…they come back with you", !!b.flat_helper, JSON.stringify(b));
  said = await body();
  check("…told so", /picks up the tools/.test(said), said.match(/[^|]*picks up the tools[^|]*/)?.[0]);
  await page.keyboard.down("ArrowUp");
  await wait(2500);
  await page.keyboard.up("ArrowUp");
  await wait(800);
  await shot("4-bring"); // they walk behind you
  await openAt(car);
  here = await buttons();
  check("back at the motorbike with them: 🛞 Fix flat", here.some((t) => /Fix flat/.test(t)) && !here.some((t) => /Wheel off/.test(t)), here.join(" / "));
  await tapWhenThere("Fix flat");
  s = await sceneUntil(/change (am|it) for you: 40 coins, about 25 seconds/);
  check(`…${b.flat_helper} offers to change it: 40 coins`, /change (am|it) for you: 40 coins/.test(s), s.slice(0, 200));
  await shot("5-helper");
  before = await coins();
  await tapWhenThere("Go ahead · 40");
  s = await sceneUntil(/Safe journey/, 80);
  b = await bike();
  check("…25 s later: done, and back on the motorbike", /Safe journey/.test(s) && b.tyre === 100 && b.in_use && !b.stranded_at && !b.flat_helper, JSON.stringify(b));
  check("…40 coins paid", (await coins()) === before - 40, `${before} → ${await coins()}`);
  await tapWhenThere("Thank you");
  await wait(1500);

  // ---- (3) With a jack
  await admin.from("player_vehicles").update({ jack: true, tyre: 0, in_use: false, stranded_at: new Date().toISOString(), lng: car.lng, lat: car.lat }).eq("user_id", id);
  await openAt(car);
  here = await buttons();
  check("with a jack, beside it: 🔧 Jack · free (and 🛞 Wheel off)", here.some((t) => /Jack · free/.test(t)) && here.some((t) => /Wheel off/.test(t)), here.join(" / "));
  await tapWhenThere("Jack · free");
  s = await sceneUntil(/Change it myself/);
  check("…change it yourself, free", /Change it myself \(jack\) · free/.test(s) && !/Go ahead · 40/.test(s), s.slice(0, 220));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
