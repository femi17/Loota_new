// A vehicle left far away (owner, 7 Nov 2026: "I went to bolivia, so my fuel for both motobike and car finished. I let
// them on the road and came back… do we charge them for someone to help them locate it"; chose a recovery truck). A
// player in Lagos whose car ran dry in Bolivia: Vehicles offers 🚚 a recovery truck with its fee; sent for, the coins go,
// the car is "On a recovery truck" (can't be taken out) until its time, then rides again with its tyre fixed and a
// little fuel. A motorbike stranded nearby gets no truck (walk to it). The test player is deleted.
//   SHOTS=<folder> node scripts/tests/vehicle-recovery-browser-test.mjs
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
const me = { lng: 3.3787, lat: 6.5186 }; // on a road in Yaba, Lagos
const bolivia = { lng: -65.2453, lat: -19.7282 }; // near Sucre
const near = { lng: 3.3812, lat: 6.5186 }; // about 280 m east

try {
  const email = `recovery-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: me.lng, home_lat: me.lat, home_set_at: new Date().toISOString(), driver_licence: true, rider_licence: true }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 2000, p_kind: "admin", p_reason: "Recovery test" });
  const strandedAt = new Date().toISOString();
  for (const row of [
    { user_id: id, kind: "car", fuel: 0, tyre: 100, engine: 100, lng: bolivia.lng, lat: bolivia.lat, in_use: false, stranded_at: strandedAt, registered: true, insured: true },
    { user_id: id, kind: "motorbike", fuel: 0, tyre: 100, engine: 100, lng: near.lng, lat: near.lat, in_use: false, stranded_at: strandedAt, registered: true, helmet: true },
  ]) {
    const { error } = await admin.from("player_vehicles").insert(row);
    if (error) throw new Error(`vehicle: ${error.message}`);
  }
  await admin.from("player_positions").upsert({ user_id: id, lng: me.lng, lat: me.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  // No road events in this test (one "just happened").
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data?.coins;

  // A motorbike stranded nearby: no truck, walk to it
  const { data: nearTry } = await c.rpc("recover_vehicle", { p_kind: "motorbike" });
  check("a motorbike 280 m away: no recovery truck (walk to it)", nearTry?.ok === false && nearTry?.reason === "near", JSON.stringify(nearTry));
  // The near motorbike out of the way of the panel's first parked vehicle
  await admin.from("player_vehicles").update({ stranded_at: null, fuel: 50 }).eq("user_id", id).eq("kind", "motorbike");

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
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  const openVehicles = async () => {
    await page.evaluate(() => document.querySelector('[data-tool="travel"]')?.click());
    await wait(1200);
  };
  await openVehicles();
  const banner = await page.evaluate((nl) => document.querySelector('[aria-label="Parked at the roadside"]')?.innerText.split(nl).join(" | ") ?? "", NL);
  const truck = await page.evaluate(() => document.querySelector("[data-recover]")?.textContent?.trim() ?? "");
  const fee = Number(truck.match(/(\d[\d,]*) coins/)?.[1]?.replace(/,/g, ""));
  check("car dry in Bolivia: Vehicles offers a recovery truck with its fee", /recovery truck/.test(truck) && fee > 1000 && fee <= 1500, truck);
  check("…and says how long (about 24 hours from there)", /about 24 hours/.test(banner), banner.slice(0, 300));
  const row = await page.evaluate(() => document.querySelector('[data-recover-row="car"]')?.textContent?.trim() ?? "");
  check("…on the car's own row too (when two are stranded, each has one)", row.includes(String(fee)), row);
  await page.screenshot({ path: `${OUT}/recovery-1-offer.png` });

  const before = await coins();
  await page.evaluate(() => document.querySelector("[data-recover]")?.click());
  await wait(3500);
  const { data: car } = await admin.from("player_vehicles").select("stranded_at, recovery_ready_at, fuel, tyre").eq("user_id", id).eq("kind", "car").single();
  const hours = (Date.parse(car.recovery_ready_at) - Date.now()) / 3600e3;
  check("sent for: the fee is paid", before - (await coins()) === fee, `${before} → ${await coins()}`);
  check("…the car is on a recovery truck for about 24 hours", !car.stranded_at && hours > 23.5 && hours <= 24, `${hours.toFixed(2)} h`);
  const said = await page.evaluate(() => document.body.innerText);
  check("…and the game says so", /recovery truck is on its way/.test(said));
  await openVehicles();
  const card = await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Vehicles"]')?.textContent ?? "");
  const takeOut = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Vehicles"] button')].find((b) => /Take it out|Ride it/.test(b.textContent ?? "") && b.closest("li")?.textContent?.includes("Car"))?.disabled);
  check("Vehicles: the car is 'On a recovery truck', and can't be taken out", /On a recovery truck/.test(card) && takeOut === true, String(takeOut));
  await page.screenshot({ path: `${OUT}/recovery-2-on-truck.png` });
  const { data: early } = await c.rpc("start_vehicle", { p_kind: "car", p_lng: me.lng, p_lat: me.lat, p_rent: false });
  check("the server won't let it out early either", early?.ok === false && early?.reason === "recovering", JSON.stringify(early));
  // Its time comes
  await admin.from("player_vehicles").update({ recovery_ready_at: ago(5) }).eq("user_id", id).eq("kind", "car");
  const { data: back } = await c.rpc("start_vehicle", { p_kind: "car", p_lng: me.lng, p_lat: me.lat, p_rent: false });
  check("back in the pocket: it drives, with a little fuel", back?.ok === true && back?.fuel >= 15, JSON.stringify(back));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
