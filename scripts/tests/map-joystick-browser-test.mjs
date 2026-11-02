// The joystick on the map (owner, 2 Nov 2026: "I did not see joystick… joystick is only needed on tablets and mobile
// phones"). On a phone, standing in Yaba:
//   1. the joystick shows (bottom left);
//   2. pushing it walks the hunter along the road, and letting go stops them;
//   3. pushing it to the right asks for a right turn at the next junction (as →);
//   4. on a computer (no touch, a wide window) there is no joystick.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/map-joystick-browser-test.mjs
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
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const yaba = { lng: 3.3787, lat: 6.5186 };
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const email = `mapjoy-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) }); // no road event midway
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

  const open = async (phone) => {
    const page = await (await browser.createBrowserContext()).newPage();
    if (phone) await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" });
    else await page.setViewport({ width: 1280, height: 800 });
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    for (let t = 0; t < 40 && !(await page.evaluate(() => window.__lootaRoad?.() ?? null)); t++) await wait(500);
    await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
    await wait(1000);
    return page;
  };
  const at = (page) => page.evaluate(() => window.__lootaRoad?.() ?? null);

  // 1–3. On a phone
  const page = await open(true);
  const stick = await page.$("[data-joystick]");
  check("on a phone: the joystick shows", !!stick);
  await page.screenshot({ path: `${OUT}/map-joystick-0.png` });
  const box = await stick.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const before = await at(page);
  await page.touchscreen.touchStart(cx, cy);
  await page.touchscreen.touchMove(cx, cy - box.height * 0.45);
  await wait(3000);
  const during = await at(page);
  await page.screenshot({ path: `${OUT}/map-joystick-1-walking.png` });
  await page.touchscreen.touchEnd();
  await wait(1500); // slowing to a stop
  const stop1 = await at(page);
  await wait(1000);
  const stop2 = await at(page);
  check("pushing it walks the hunter", !!before && !!during && metres(before, during) > 3, before && during ? `${metres(before, during).toFixed(1)} m in 3 s` : "no road");
  check("…and letting go stops them", !!stop1 && !!stop2 && metres(stop1, stop2) < 0.3, stop1 && stop2 ? `${metres(stop1, stop2).toFixed(2)} m` : "");
  await page.touchscreen.touchStart(cx, cy);
  await page.touchscreen.touchMove(cx + box.width * 0.45, cy);
  await wait(300);
  await page.touchscreen.touchEnd();
  const turning = await page.evaluate(() => !!document.querySelector('[aria-label^="Turning right at the next junction"]'));
  check("pushed to the right: a right turn at the next junction", turning);
  await page.screenshot({ path: `${OUT}/map-joystick-2-turn.png` });

  // 4. On a computer
  const desk = await open(false);
  check("on a computer: no joystick", !(await desk.$("[data-joystick]")));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
