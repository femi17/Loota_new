// Gold "do it here" buttons answer only a deliberate tap, and the phone camera shows the road ahead (owner, 28 Oct 2026:
// "my hands are mistakenly pressing the prompts on the screen like refuel"; "too close to the front"). On a phone at a
// petrol station with a dry motorbike in the pocket: a touch the moment Refuel appears does nothing; a thumb held on it
// (as when holding to move) does nothing; a swipe across it does nothing; a quick tap a moment later opens the
// attendant. The hunter sits about two-thirds of the way down the phone's screen (centred on a laptop's).
// The test player is deleted.   node scripts/tests/here-tap-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let browser, id = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const box = { lng0: 3.37, lng1: 3.39, lat0: 6.51, lat1: 6.53 }; // Yaba

try {
  const station = (await admin.from("places").select("name, lng, lat").eq("kind", "fuel").gte("lng", box.lng0).lte("lng", box.lng1).gte("lat", box.lat0).lte("lat", box.lat1).limit(1)).data[0];
  const email = `heretap-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: station.lng, home_lat: station.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Here-tap test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: station.lng, lat: station.lat, mode: "walk", energy: 80, updated_at: ago(30) });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 0, tyre: 100, engine: 100, lng: station.lng, lat: station.lat, in_use: false });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });

  const refuel = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => /Refuel/.test(e.textContent ?? ""));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const sceneOpen = () => page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label^="Petrol station"]'));

  // The moment it appears: a tap meant for the map
  let at = null;
  for (let i = 0; i < 400 && !at; i++) {
    at = await refuel();
    if (!at) await wait(100);
  }
  check("Refuel appears at the station", !!at);
  await page.touchscreen.tap(at.x, at.y);
  await wait(2500);
  check("…a tap the moment it appears does nothing", !(await sceneOpen()));
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());

  // The camera: the hunter two-thirds of the way down (phone)
  const y = await page.evaluate(() => {
    const p = window.__lootaRoad?.();
    return p ? window.__lootaMap.project([p.lng, p.lat]).y / innerHeight : null;
  });
  check("the hunter sits low on the phone's screen, the road ahead above", y !== null && y > 0.6 && y < 0.72, y?.toFixed(2));

  // A thumb held on it (as when holding to move), then lifted
  at = await refuel();
  await page.touchscreen.touchStart(at.x, at.y);
  await wait(1200);
  await page.touchscreen.touchEnd();
  await wait(2500);
  check("…a thumb held on it, then lifted, does nothing", !(await sceneOpen()));

  // A swipe that starts on it
  at = await refuel();
  await page.touchscreen.touchStart(at.x, at.y);
  for (let k = 1; k <= 5; k++) {
    await page.touchscreen.touchMove(at.x + k * 12, at.y - k * 6);
    await wait(30);
  }
  await page.touchscreen.touchEnd();
  await wait(2500);
  check("…a swipe across it does nothing", !(await sceneOpen()));

  // A deliberate tap
  at = await refuel();
  await page.touchscreen.tap(at.x, at.y);
  let open = false;
  for (let i = 0; i < 20 && !open; i++) {
    await wait(300);
    open = await sceneOpen();
  }
  check("…a quick tap opens the attendant", open);
  check("no page errors", problems.length === 0, problems.join(" / "));

  // A laptop keeps the hunter in the middle
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("about:blank");
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  const yWide = await page.evaluate(() => {
    const p = window.__lootaRoad?.();
    return p ? window.__lootaMap.project([p.lng, p.lat]).y / innerHeight : null;
  });
  check("on a laptop the hunter stays in the middle", yWide !== null && Math.abs(yWide - 0.5) < 0.05, yWide?.toFixed(2));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
