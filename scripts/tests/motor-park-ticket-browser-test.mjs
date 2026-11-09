// A motor park's ticket office (owner, 9 Nov 2026, at Mallam Karto Park, Kano: "I picked to go to abuja, it directed me
// to a motor park, but getting there, nothing happens. I should buy ticket since this is a inter state motor park").
// On a phone, where the owner stood (on the road 48 m from the park's point): a journey to Abuja by long-distance bus;
// at the park, the journey card offers "🎫 Buy a ticket" (it showed nothing: 40 m was "at the stop"); it leads to the
// park's ticket office at the road; the clerk names the fare and the next bus; paying begins the trip, the fare paid;
// "To the bus". The test player is deleted.
//   SHOTS=<folder> node scripts/tests/motor-park-ticket-browser-test.mjs
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
const SPOT = { lng: 8.53948523120476, lat: 12.0072620902259 }; // where the owner stood, by Mallam Karto Park
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const email = `park-ticket-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: SPOT.lng, home_lat: SPOT.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 20000, p_kind: "admin", p_reason: "Motor park test" });
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
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click()); // the Djinn's summons, if any
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const clickText = (x) => page.evaluate((s) => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent?.trim().startsWith(s) || e.getAttribute("aria-label")?.startsWith(s)) && !e.disabled);
    b?.click();
    return !!b;
  }, x);
  const clickWhenThere = async (x, tries = 30) => {
    for (let i = 0; i < tries; i++) { if (await clickText(x)) return true; await wait(500); }
    return false;
  };
  const textWhen = async (sel, re, tries = 40) => {
    let t = null;
    for (let i = 0; i < tries && !re.test(t ?? ""); i++) { await wait(500); t = await text(sel); }
    return t;
  };

  // The journey to Abuja, by long-distance bus
  await page.evaluate(() => document.querySelector('[data-tool="directions"]').click());
  for (let i = 0; i < 20 && !(await page.evaluate(() => !!document.querySelector('input[type="search"]'))); i++) await wait(500);
  await page.type('input[type="search"]', "Abuja");
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!document.querySelector('[aria-label="Places found"] [role="option"] button'))); i++) await wait(500);
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[aria-label="Places found"] [role="option"] button')].find((x) => /Abuja/.test(x.textContent ?? ""));
    b?.click();
    return b?.textContent ?? null;
  });
  check("searched Abuja", !!picked, picked ?? "none");
  const coach = await page.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const li = [...document.querySelectorAll('[aria-label="Plan the journey"] li')].find((x) => /Long-distance bus/.test(x.textContent ?? ""));
      if (li) { const t = li.textContent; [...li.querySelectorAll("button")].find((b) => /Go this way/.test(b.textContent ?? ""))?.click(); return t; }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  });
  check("the journey by long-distance bus, from Mallam Karto Park", !!coach && /Mallam Karto/.test(coach), (coach ?? "none").slice(0, 160));

  // At the park (the road beside it): the card offers the ticket
  const card = await textWhen('[aria-label="Your journey"]', /Buy a ticket/, 40);
  check("at the park: the journey card offers 🎫 Buy a ticket", /Buy a ticket · about [\d,]+ coins/.test(card ?? ""), card);
  const office = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).find((x) => /Ticket office/.test(x ?? "")) ?? null);
  check("…and the gold 🎫 Ticket office button (the park counts you there from the road)", !!office, office ?? "none");
  await page.screenshot({ path: `${OUT}/park-1-card.png` });
  await clickText("🎫 Buy a ticket");

  // To the office's door if it isn't right here, then in
  let hall = await textWhen('[role="dialog"][aria-label^="Ticket office at"]', /the ride takes about/, 30);
  if (!hall) {
    for (let i = 0; i < 40 && !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /Ticket office/.test(b.textContent ?? "") && !/· \d+ m/.test(b.textContent ?? "")))); i++) await wait(500);
    await clickWhenThere("🎫 Ticket office");
    hall = await textWhen('[role="dialog"][aria-label^="Ticket office at"]', /the ride takes about/, 30);
  }
  check("in the park's ticket office: the clerk names the fare and the next bus", /that's [\d,]+ coins\. The next bus leaves in about/.test(hall ?? ""), hall?.slice(0, 220));
  await page.screenshot({ path: `${OUT}/park-2-office.png` });
  const before = (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  check("…pay", await clickWhenThere("Pay ·"));
  const ticket = await textWhen('[role="dialog"]', /loading at the bay/); // (the clerk's words type out)
  const { data: trip } = await admin.from("transit_trips").select("mode, from_name, to_name, fare").eq("user_id", id).is("ended_at", null).maybeSingle();
  const after = (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  check("the ticket: the bus trip from Mallam Karto Park begins, the fare paid", /Here's your ticket/.test(ticket ?? "") && trip?.mode === "bus" && /Mallam Karto/.test(trip.from_name) && after === before - trip.fare, JSON.stringify(trip));
  check("…the clerk sends you to the loading bay", /loading at the bay/.test(ticket ?? ""), ticket?.slice(-160));
  await page.screenshot({ path: `${OUT}/park-3-ticket.png` });
  check("…\"To the bus\"", await clickWhenThere("Thanks! To the bus"));
  await wait(2500);
  const status = await text('[aria-label="Your trip"]');
  check("…then waiting for the bus to Abuja", /Bus to/.test(status ?? ""), status);
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
