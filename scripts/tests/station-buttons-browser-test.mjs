// The petrol station's buttons follow what you ride (phone): walking past with a soft-tyred bicycle and a half-full
// motorbike in the pocket, no Pump and no Refuel; on the bicycle, Pump; an empty motorbike in the pocket, Refuel.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/station-buttons-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  // A petrol station in the map's places, by a road near Yaba.
  const { data: stations } = await admin.from("places").select("name, lng, lat").eq("kind", "fuel").gte("lng", 3.37).lte("lng", 3.39).gte("lat", 6.51).lte("lat", 6.53).limit(1);
  const station = stations[0];
  const email = `station-b-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: station.lng, home_lat: station.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 100, p_kind: "admin", p_reason: "Station buttons test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: station.lng, lat: station.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  await admin.from("player_vehicles").insert([
    { user_id: id, kind: "bicycle", fuel: 0, tyre: 30, engine: 100, lng: station.lng, lat: station.lat, in_use: false },
    { user_id: id, kind: "motorbike", fuel: 50, tyre: 100, engine: 100, lng: station.lng, lat: station.lat, in_use: false },
  ]);

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const buttons = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "").filter((t) => /Pump|Fix flat|Refuel|keg|Service/.test(t)));
  const open = async () => {
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };

  await open();
  const walking = await buttons();
  check(`walking past ${station.name}: no Pump, no Refuel`, walking.length === 0, walking.join(" / "));
  await page.screenshot({ path: `${OUT}/station-1-walking.png` });

  await page.evaluate(() => document.querySelector('[data-tool="travel"]')?.click());
  await wait(1000);
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Vehicles"] li')].find((x) => x.querySelector("span")?.textContent === "Bicycle")?.querySelector("button")?.click());
  await wait(4000);
  const cycling = await buttons();
  check("on the bicycle with soft tyres: Pump", cycling.some((t) => /Pump/.test(t)) && !cycling.some((t) => /Refuel/.test(t)), cycling.join(" / "));
  await page.screenshot({ path: `${OUT}/station-2-cycling.png` });

  // An empty motorbike in the pocket can't come out until it's filled: Refuel is offered, on foot or not.
  await admin.from("player_vehicles").update({ fuel: 0 }).eq("user_id", id).eq("kind", "motorbike");
  await page.goto("about:blank");
  await open();
  const empty = await buttons();
  check("an empty motorbike in the pocket: Refuel", empty.some((t) => /Refuel/.test(t)), empty.join(" / "));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
