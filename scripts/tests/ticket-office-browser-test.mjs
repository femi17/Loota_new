// Tickets and check-in on the map (phone): at Yaba station the gold "Ticket office" button → the ticket hall (the
// clerk behind the glass, the departures board, a train beyond) → where to → the fare → pay → the ticket, the trip
// begins; at Lagos airport, a flight chosen in the travel panel → "Check in at the airport" → the terminal → the
// fare → check in → ID → bag on the scale → boarding pass → the departure lounge (you walk in and sit; the board counts
// down; "Look at the map" leaves a chip back to it). The test players are deleted.
//   SHOTS=<folder> node scripts/tests/ticket-office-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

async function player(tag, at) {
  const email = `ticket-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 3000, p_kind: "admin", p_reason: "Ticket office test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  return { id, jar };
}

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const open = async (who) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...who.jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
    const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
    const clickText = (x) => page.evaluate((s) => {
      const b = [...document.querySelectorAll("button")].find((e) => (e.textContent?.trim().startsWith(s) || e.getAttribute("aria-label")?.startsWith(s)) && !e.disabled);
      b?.click();
      return !!b;
    }, x);
    const clickWhenThere = async (x, tries = 24) => {
      for (let i = 0; i < tries; i++) {
        if (await clickText(x)) return true;
        await wait(500);
      }
      return false;
    };
    const textWhen = async (sel, re, tries = 24) => {
      let t = null;
      for (let i = 0; i < tries && !re.test(t ?? ""); i++) {
        await wait(500);
        t = await text(sel);
      }
      return t;
    };
    return { page, problems, text, clickText, clickWhenThere, textWhen };
  };
  const coins = async (id) => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const tripOf = async (id) => (await admin.from("transit_trips").select("mode, to_name, fare").eq("user_id", id).is("ended_at", null).maybeSingle()).data;

  // ---- 1. The train: Yaba station's ticket office
  const yaba = (await admin.from("transit_stops").select("id, name, lng, lat").eq("kind", "train").eq("name", "Yaba").single()).data;
  const rider = await player("train", yaba);
  const t = await open(rider);
  const button = await t.page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).find((x) => /Ticket office/.test(x ?? "")) ?? null);
  check("at Yaba station: the Ticket office button", !!button, button ?? "none");
  await t.clickText("🎫 Ticket office");
  const greet = await t.textWhen('[role="dialog"][aria-label="Ticket office at Yaba station"]', /Where are you travelling to\?/);
  check("in the ticket hall: the clerk asks where to", /Where are you travelling to\?/.test(greet ?? ""), greet);
  const dest = await t.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent ?? "").find((x) => / · \d+$/.test(x)));
  check("…with the line's stations and fares", !!dest, dest ?? "none");
  await t.page.screenshot({ path: `${OUT}/ticket-1-hall.png` });
  await t.clickWhenThere(dest);
  const fare = await t.textWhen('[role="dialog"]', /the ride takes about \d/);
  check("…the fare and the next train", /that's \d+ coins\. The next train leaves in/.test(fare ?? ""), fare);
  const before = await coins(rider.id);
  check("…pay", await t.clickWhenThere("Pay ·"));
  const ticket = await t.textWhen('[role="dialog"]', /Here's your ticket/);
  const trip = await tripOf(rider.id);
  check("the ticket: the trip begins, the fare paid", /Here's your ticket/.test(ticket ?? "") && trip?.mode === "train" && (await coins(rider.id)) === before - trip.fare, JSON.stringify(trip));
  await t.page.screenshot({ path: `${OUT}/ticket-2-ticket.png` });
  await t.clickWhenThere("Thanks! To the platform");
  await wait(2500);
  const status = await t.text('[aria-label="Your trip"]');
  check("…then on the platform, the train coming", /Train to/.test(status ?? ""), status);
  check("no page errors (train)", t.problems.length === 0, t.problems.join(" / "));
  await t.page.close();

  // ---- 2. The plane: chosen in the travel panel, checked in at the terminal
  const los = (await admin.from("transit_stops").select("id, name, lng, lat, desk_lng, desk_lat").eq("kind", "plane").eq("code", "LOS").single()).data;
  // At the terminal's door (the check-in desk the server insists on).
  const flyer = await player("plane", { lng: los.desk_lng, lat: los.desk_lat });
  const p = await open(flyer);
  await p.page.evaluate(() => document.querySelector('[data-tool="transit"]')?.click());
  await p.clickWhenThere("Flights within");
  const flight = await p.page.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      const row = [...document.querySelectorAll('[aria-label="Bus, train or plane"] li button')][0];
      if (row) { const name = row.textContent; row.click(); return name; }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  });
  check("the travel panel: a flight chosen", !!flight, flight ?? "none");
  const panelButton = await p.page.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      const b = [...document.querySelectorAll("button")].find((x) => /Check in at the airport/.test(x.textContent ?? ""));
      if (b) return b.textContent;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  });
  check("…no paying from the panel: \"Check in at the airport\"", !!panelButton && !(await p.page.evaluate(() => [...document.querySelectorAll("button")].some((x) => /and board/.test(x.textContent ?? "")))), panelButton ?? "none");
  await p.clickText("🛫 Check in at the airport");
  await wait(2000);
  const said = await p.page.evaluate(() => document.querySelector('[aria-label="Bus, train or plane"]')?.textContent ?? "");
  if (/follow the blue line/.test(said)) {
    // Not at the desk yet: walk there along the blue line (here: set down at the terminal door, as if walked).
    console.log("   (the way to the desk: " + said.match(/Check in at[^.]*\./)?.[0] + ")");
  }
  const desk = await p.textWhen('[role="dialog"][aria-label^="Check-in at"]', /Shall I check you in\?/);
  check("at the check-in desk: the agent names the fare", /Shall I check you in\?/.test(desk ?? ""), desk);
  await p.page.screenshot({ path: `${OUT}/ticket-3-checkin.png` });
  const pBefore = await coins(flyer.id);
  check("…check in", await p.clickWhenThere("Yes, check me in"));
  check("…your ID", await p.clickWhenThere("Here you go"));
  check("…the bag on the scale", await p.clickWhenThere("Put my bag on the scale"));
  await wait(1500);
  await p.page.screenshot({ path: `${OUT}/ticket-4-bag.png` });
  const pass = await p.textWhen('[role="dialog"]', /boarding pass/);
  const ptrip = await tripOf(flyer.id);
  check("the boarding pass: the flight booked, the fare paid", /boarding pass to .*Gate \d/.test(pass ?? "") && ptrip?.mode === "plane" && (await coins(flyer.id)) === pBefore - ptrip.fare, JSON.stringify(ptrip));
  // The departure lounge (owner, 26 Oct 2026: "make the user walk to the lounge to sit… a scene").
  const gate = (pass ?? "").match(/Gate (\d)/)?.[1];
  check("…then to the lounge", await p.clickWhenThere("Thanks! To the lounge"));
  const lounge = await p.textWhen('[role="dialog"][aria-label="Departure lounge"]', /Sit back/, 30);
  check("the lounge: you sit, the board counts down to boarding at the same gate", /Departure lounge/.test(lounge ?? "") && new RegExp(`GATE ${gate}`).test(lounge ?? "") && /BOARDING IN \d+:\d\d/.test(lounge ?? "") && /Sit back/.test(lounge ?? ""), (lounge ?? "").split("\n").join(" | "));
  await p.page.screenshot({ path: `${OUT}/ticket-5-lounge.png` });
  await p.clickWhenThere("Look at the map");
  await wait(800);
  const chipText = await p.text('button[aria-label="Back to the lounge"]');
  check("Look at the map: a chip to go back", /Lounge · boards in \d+:\d\d/.test(chipText ?? "") && !(await p.page.$('[role="dialog"][aria-label="Departure lounge"]')), chipText);
  await p.page.evaluate(() => document.querySelector('button[aria-label="Back to the lounge"]')?.click());
  await wait(800);
  check("…and back in the lounge", !!(await p.page.$('[role="dialog"][aria-label="Departure lounge"]')));
  check("no page errors (plane)", p.problems.length === 0, p.problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    await admin.from("transit_trips").update({ ended_at: new Date().toISOString(), outcome: "cancelled" }).eq("user_id", id).is("ended_at", null);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
