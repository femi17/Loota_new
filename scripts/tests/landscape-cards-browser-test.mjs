// A phone held sideways (owner, 9 Nov 2026: "reduce the bus or direct toast at the top left on the mobile landscape. It
// extends to the center of the screen and blocks the avatar, or activity"). At Mallam Karto Park, Kano: a journey to
// Abuja by long-distance bus (the journey card), then its ticket bought (the bus trip card); and directions to a tapped
// spot (the directions card). Each card on the left stays narrow (under 300 px), clear of the hunter in the middle of the
// screen, with its words still in readable type. Upright on the same phone, the cards are as before. The test player is
// deleted.   SHOTS=<folder> node scripts/tests/landscape-cards-browser-test.mjs
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
const SPOT = { lng: 8.53948523120476, lat: 12.0072620902259 }; // by Mallam Karto Park
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const email = `side-cards-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: SPOT.lng, home_lat: SPOT.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 5000, p_kind: "admin", p_reason: "Landscape cards test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: SPOT.lng, lat: SPOT.lat, mode: "walk", energy: 95, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); sessionStorage.setItem("loota:fs-offered", "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^(Not now|✕)$/.test(b.textContent?.trim() ?? "") || b.getAttribute("aria-label") === "Close")?.click());
    await wait(500);
  }
  const clickText = (x) => page.evaluate((s) => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent?.trim().startsWith(s) || e.getAttribute("aria-label")?.startsWith(s)) && !e.disabled);
    b?.click();
    return !!b;
  }, x);
  const box = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const title = el.querySelector(".text-base, .text-sm");
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), font: title ? parseFloat(getComputedStyle(title).fontSize) : null };
  }, sel);
  const clear = (b) => !!b && b.right - b.left <= 300 && b.right < 844 / 2 - 40;

  // The journey card (Abuja by long-distance bus)
  await page.evaluate(() => document.querySelector('[data-tool="directions"]').click());
  for (let i = 0; i < 20 && !(await page.evaluate(() => !!document.querySelector('input[type="search"]'))); i++) await wait(500);
  await page.type('input[type="search"]', "Abuja");
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!document.querySelector('[aria-label="Places found"] [role="option"] button'))); i++) await wait(500);
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Places found"] [role="option"] button')].find((x) => /Abuja/.test(x.textContent ?? ""))?.click());
  await page.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const li = [...document.querySelectorAll('[aria-label="Plan the journey"] li')].find((x) => /Long-distance bus/.test(x.textContent ?? ""));
      if (li) { [...li.querySelectorAll("button")].find((b) => /Go this way/.test(b.textContent ?? ""))?.click(); return; }
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  for (let i = 0; i < 40 && !(await page.evaluate(() => /Buy a ticket/.test(document.querySelector('[aria-label="Your journey"]')?.textContent ?? ""))); i++) await wait(500);
  const journey = await box('[aria-label="Your journey"]');
  check("sideways: the journey card narrow, clear of the middle", clear(journey), JSON.stringify(journey));
  check("…its words still readable (11 px or more)", (journey?.font ?? 0) >= 11, `${journey?.font} px`);
  await page.screenshot({ path: `${OUT}/side-1-journey.png` });

  // The bus trip card: the ticket bought
  await clickText("🎫 Buy a ticket");
  for (let i = 0; i < 40 && !(await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => /^Pay ·/.test(b.textContent?.trim() ?? "")))); i++) {
    if (i === 20) await clickText("🎫 Ticket office");
    await wait(500);
  }
  await clickText("Pay ·");
  for (let i = 0; i < 30 && !(await clickText("Thanks! To the bus")); i++) await wait(500);
  for (let i = 0; i < 20 && !(await page.evaluate(() => !!document.querySelector('[aria-label="Your trip"]'))); i++) await wait(500);
  const trip = await box('[aria-label="Your trip"]');
  check("sideways: the bus trip card narrow, clear of the middle", clear(trip), JSON.stringify(trip));
  check("…its words still readable (11 px or more)", (trip?.font ?? 0) >= 11, `${trip?.font} px`);
  await page.screenshot({ path: `${OUT}/side-2-bus.png` });
  await clickText("Cancel");
  await wait(3000);
  await page.evaluate(() => document.querySelector('button[aria-label="End the journey"]')?.click());
  await wait(1500);

  // The directions card: a tap on the map
  await page.evaluate(() => {
    const m = window.__lootaMap;
    const c = m.getCenter();
    const t = { lng: c.lng + 0.003, lat: c.lat + 0.002 };
    m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
  });
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!document.querySelector('[aria-label="Directions"]'))); i++) await wait(500);
  const dirs = await box('[aria-label="Directions"]');
  check("sideways: the directions card narrow, clear of the middle", clear(dirs), JSON.stringify(dirs));
  await page.screenshot({ path: `${OUT}/side-3-directions.png` });

  // Upright: as before
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await wait(1500);
  const up = await box('[aria-label="Directions"]');
  check("upright: the directions card as before (the screen's width)", !!up && up.right - up.left > 300, JSON.stringify(up));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
