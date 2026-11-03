// A car left at the roadside, seen to from the bicycle (phone; owner, 3 Nov 2026: "it says go to the gas station, and
// when I got there with the jerry can nothing happened… I went back to my car… 'Your car has a flat'… I clicked yet
// nothing happened"). (1) Dry, with a full jerry can: Vehicles says no petrol station is needed; beside it on the
// bicycle, its button pours the can in. (2) A flat, beside it on the bicycle: 🛞 Wheel off (no vulcanizer by the road:
// owner, 3 Nov 2026), and Vehicles says find one. (3) A petrol station down its own driveway: no Refuel on the main road,
// Refuel down the driveway. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/parked-car-browser-test.mjs
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
const car = { lng: 3.3787, lat: 6.5186 }; // on a road in Yaba
const away = { lng: 3.3812, lat: 6.5186 }; // about 280 m east
// Petrol station 7306 in Yaba (scripts/tests/place-driveways-check.mts): 1 m from its driveway, 26 m from the main road.
const driveway = { lng: 3.385341, lat: 6.519144 };
const mainRoad = { lng: 3.385116, lat: 6.519202 };

try {
  const email = `parked-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: car.lng, home_lat: car.lat, home_set_at: new Date().toISOString(), driver_licence: true }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 300, p_kind: "admin", p_reason: "Parked car test" });
  for (const row of [
    { user_id: id, kind: "car", fuel: 0, tyre: 100, engine: 100, lng: car.lng, lat: car.lat, in_use: false, stranded_at: new Date().toISOString(), registered: true, insured: true },
    { user_id: id, kind: "bicycle", fuel: 100, tyre: 100, engine: 100, lng: away.lng, lat: away.lat, in_use: true },
  ]) {
    const { error } = await admin.from("player_vehicles").insert(row);
    if (error) throw new Error(`vehicle: ${error.message}`);
  }
  const { error: kegError } = await admin.from("player_kegs").insert({ user_id: id, fuel: 65, uses_left: 40 });
  if (kegError) throw new Error(`keg: ${kegError.message}`);
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
  const shot = (name) => page.screenshot({ path: `${OUT}/parked-${name}.png` });
  const goldButtons = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "").filter((t) => /Fix flat|Wheel off|Pour can|Refuel|Jerry can/.test(t)));
  const dialog = (label) => page.evaluate((l, nl) => document.querySelector(`[role="dialog"][aria-label="${l}"]`)?.innerText.split(nl).join(" | ") ?? "", label, NL);
  const openAt = async (at, mode = "bicycle") => {
    await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode, energy: 100, updated_at: ago(20) });
    await page.goto("about:blank");
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };
  const vehicles = async () => {
    await page.evaluate(() => document.querySelector('[data-tool="travel"]')?.click());
    await wait(1200);
    return page.evaluate((nl) => document.querySelector('[aria-label="Parked at the roadside"]')?.innerText.split(nl).join(" | ") ?? "", NL);
  };
  const tapParked = () => page.evaluate(() => {
    const b = document.querySelector('[aria-label="Parked at the roadside"] button');
    b?.click();
    return b?.textContent?.trim() ?? "";
  });

  // ---- (1) Dry, with a full jerry can, 280 m away on the bicycle
  await openAt(away);
  let card = await vehicles();
  check("dry, with a full can: no petrol station needed", /already carry fuel/.test(card) && !/Fill a jerry can at a petrol station/.test(card), card);
  check("…the button shows the way to the car", /The way to it/.test(card));
  await shot("1-dry-far");
  await page.evaluate(() => document.querySelector('[aria-label="Vehicles"] button[aria-label="Close"]')?.click());
  // Beside it, still on the bicycle
  await openAt(car);
  card = await vehicles();
  check("beside it: 'Pour the jerry can in'", /Pour the jerry can in/.test(card), card);
  await tapParked();
  let pour = "";
  for (let i = 0; i < 20 && !pour; i++) { await wait(400); pour = await dialog("Pouring the jerry can"); }
  check("…tapping it starts the pour", !!pour, pour.slice(0, 120));
  await shot("2-pour");
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"][aria-label="Pouring the jerry can"] button')].find((e) => e.textContent?.includes("Pour it in")); b?.click(); return !!b; })) break;
    await wait(300);
  }
  let v = null;
  for (let i = 0; i < 30; i++) { await wait(500); v = (await admin.from("player_vehicles").select("fuel, in_use, stranded_at").eq("user_id", id).eq("kind", "car").single()).data; if (v.in_use) break; }
  check("…the car has fuel and you're back in it", v.fuel >= 60 && v.in_use && !v.stranded_at, JSON.stringify(v));

  // ---- (2) A flat, beside it on the bicycle
  await admin.from("player_vehicles").update({ in_use: false, stranded_at: new Date().toISOString(), tyre: 0, lng: car.lng, lat: car.lat }).eq("user_id", id).eq("kind", "car");
  await admin.from("player_vehicles").update({ in_use: true }).eq("user_id", id).eq("kind", "bicycle");
  await openAt(car);
  const here = await goldButtons();
  check("a flat, beside it on the bicycle: the 🛞 Wheel off button", here.some((t) => /Wheel off/.test(t)), here.join(" / "));
  card = await vehicles();
  check("…Vehicles: find a vulcanizer, 'Take the wheel off'", /No vulcanizer by the road/.test(card) && /Take the wheel off/.test(card), card);
  await tapParked();
  let w = null;
  for (let i = 0; i < 20; i++) { await wait(500); w = (await admin.from("player_vehicles").select("flat_wheel").eq("user_id", id).eq("kind", "car").single()).data; if (w.flat_wheel) break; }
  check("…tapping it takes the wheel off", w?.flat_wheel === "off", JSON.stringify(w));
  await shot("3-flat");

  // ---- (3) A petrol station down its own driveway (an empty car in the pocket wants Refuel)
  await admin.from("player_vehicles").update({ stranded_at: null, tyre: 100, fuel: 0, in_use: false, flat_wheel: null }).eq("user_id", id).eq("kind", "car");
  await admin.from("player_vehicles").update({ in_use: false }).eq("user_id", id).eq("kind", "bicycle");
  await openAt(mainRoad, "walk");
  const onMain = await goldButtons();
  check("on the main road beside the station: no Refuel yet", !onMain.some((t) => /Refuel/.test(t)), onMain.join(" / "));
  await shot("4-main-road");
  await openAt(driveway, "walk");
  const inDrive = await goldButtons();
  check("down its driveway: Refuel", inDrive.some((t) => /Refuel/.test(t)), inDrive.join(" / "));
  await shot("5-driveway");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
