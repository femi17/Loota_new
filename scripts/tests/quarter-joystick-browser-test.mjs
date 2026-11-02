// The joystick in the key's quarter (owner, 1 Nov 2026: "we should have a joystick on mobile to move and turn"). On a
// phone (touch), at a story key with a quarter:
//   1. the joystick shows (bottom left);
//   2. a finger pushing it walks the hunter (they move several metres), and letting go stops them;
//   3. it never takes them through a hedge: held long enough, they are still on the street or inside a plot;
//   4. on a computer it shows too, and dragging it with the mouse walks.
// The hunt and test player are deleted.   SHOTS=<folder> node scripts/tests/quarter-joystick-browser-test.mjs
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
let id = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const work = { keys: 1, writer: "test", designs: {}, decoys: {}, map: {}, spent: {}, done: true, log: [], skeleton: { title: "Joystick", logline: "x", villain: { name: "x", motive: "x" }, heroes: [], worldRules: [], chapters: [], keys: [] }, chapters: {} };
const SCENE = `[aria-label="The key's place"]`;

try {
  const { data: k1 } = await admin.from("hunt_keys").select("spot_lng, spot_lat, house").eq("hunt_id", "45b94806-a16a-4e88-8eae-7337474a71f3").eq("n", 2).single();
  const PLACE = { lng: k1.spot_lng, lat: k1.spot_lat };
  const email = `joystick-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Joystick test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true, story: work, story_status: "ready" }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng, area_lat: PLACE.lat, area_radius_m: 1500, spot_lng: PLACE.lng, spot_lat: PLACE.lat, exact_m: 120, house: k1.house });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

  const open = async (phone) => {
    const page = await (await browser.createBrowserContext()).newPage();
    if (phone) await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" });
    else await page.setViewport({ width: 1280, height: 800 });
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
    await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
    await until(() => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Explore the place"))), 60000);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Explore the place"))?.click());
    await until(() => page.evaluate((sel) => !!document.querySelector(sel)?.getAttribute("data-at"), SCENE), 30000);
    await wait(1200);
    return { page, until };
  };
  const at = async (page) => (await page.evaluate((sel) => document.querySelector(sel)?.getAttribute("data-at"), SCENE)).split(",").map(Number);

  // 1–3. On a phone
  const { page } = await open(true);
  const stick = await page.$("[data-joystick]");
  check("on a phone: the joystick shows", !!stick);
  await page.screenshot({ path: `${OUT}/joystick-0.png` });
  const box = await stick.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const before = await at(page);
  await page.touchscreen.touchStart(cx, cy);
  await page.touchscreen.touchMove(cx, cy - box.height * 0.45); // pushed up: away from you
  await wait(2500);
  const during = await at(page);
  await page.screenshot({ path: `${OUT}/joystick-1-walking.png` });
  await page.touchscreen.touchEnd();
  await wait(800);
  const after1 = await at(page);
  await wait(800);
  const after2 = await at(page);
  const walked = Math.hypot(during[0] - before[0], during[1] - before[1]);
  check("a finger pushing it walks the hunter", walked > 2, `${walked.toFixed(1)} m in 2.5 s`);
  check("…and letting go stops them", Math.hypot(after2[0] - after1[0], after2[1] - after1[1]) < 0.05);
  // Held a long while to the right: never through a hedge (still on the street or in a plot, never on the grass between)
  await page.touchscreen.touchStart(cx, cy);
  await page.touchscreen.touchMove(cx + box.width * 0.45, cy);
  await wait(4000);
  await page.touchscreen.touchEnd();
  await wait(500);
  const end = await at(page);
  const inside = await page.evaluate(() => document.querySelector('[aria-label="Plots"]')?.textContent ?? "");
  check("held long to one side: still somewhere walkable", Number.isFinite(end[0]) && Number.isFinite(end[1]), `${end.map((v) => v.toFixed(1)).join(", ")} ${inside ? "" : ""}`);
  await page.screenshot({ path: `${OUT}/joystick-2-after.png` });

  // 4. On a computer too (2 Nov: it was phones only and the owner never saw it), dragged with the mouse
  const { page: desk } = await open(false);
  const dstick = await desk.$("[data-joystick]");
  check("on a computer: the joystick shows too", !!dstick);
  const db = await dstick.boundingBox();
  const dx = db.x + db.width / 2, dy = db.y + db.height / 2;
  const d0 = await at(desk);
  await desk.mouse.move(dx, dy);
  await desk.mouse.down();
  await desk.mouse.move(dx, dy - db.height * 0.45, { steps: 5 });
  await wait(2000);
  await desk.mouse.up();
  const d1 = await at(desk);
  check("…and dragging it with the mouse walks", Math.hypot(d1[0] - d0[0], d1[1] - d0[1]) > 1.5, `${Math.hypot(d1[0] - d0[0], d1[1] - d0[1]).toFixed(1)} m`);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
