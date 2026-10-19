// The ticket office from wherever you stand at the station (owner, 19 Oct 2026: "the buy ticket for train… not
// showing a scene or anything when I got to the ticket location"), on a phone: on a motorbike at the owner's spot by
// Alaba station (38 m from the stop, the office door further), the gold "Ticket office" button shows with how far the
// door is; tapping it walks you in; the clerk, a destination, the fare, pay: the ticket, the trip begins (the server's
// desk check passes). The test player is deleted.   SHOTS=<folder> node scripts/tests/ticket-near-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const spot = { lng: 3.3246546871792, lat: 6.46407380334884 }; // where the owner stood, by Alaba station

try {
  const email = `ticketnear-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 1000, p_kind: "admin", p_reason: "Ticket near test" });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 80, tyre: 100, engine: 100, lng: spot.lng, lat: spot.lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "motorbike", energy: 100, updated_at: new Date(Date.now() - 30000).toISOString() });
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
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const clickWhenThere = async (x) => {
    for (let i = 0; i < 24; i++) {
      if (await page.evaluate((s) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((e) => e.textContent?.includes(s) && !e.disabled); b?.click(); return !!b; }, x)) return true;
      await wait(500);
    }
    return false;
  };
  const textWhen = async (sel, re, tries = 30) => {
    let t = null;
    for (let i = 0; i < tries && !re.test(t ?? ""); i++) {
      await wait(500);
      t = await text(sel);
    }
    return t;
  };
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);

  const button = await page.evaluate(() => document.querySelector('button[aria-label="The ticket office at Alaba station"]')?.textContent?.trim() ?? null);
  check("at Alaba station on a motorbike: the Ticket office button, with how far the door is", /Ticket office/.test(button ?? ""), button ?? "none");
  await page.screenshot({ path: `${OUT}/ticketnear-1-button.png` });
  await page.evaluate(() => document.querySelector('button[aria-label="The ticket office at Alaba station"]')?.click());
  const greet = await textWhen('[role="dialog"][aria-label="Ticket office at Alaba station"]', /Where are you travelling to\?/);
  check("tapped: into the ticket hall, the clerk asks where to", /Where are you travelling to\?/.test(greet ?? ""), greet?.slice(0, 160));
  await wait(1500);
  await page.screenshot({ path: `${OUT}/ticketnear-2-hall.png` });
  const dest = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent ?? "").find((x) => / · \d+$/.test(x)));
  check("…the line's stations and fares", !!dest, dest ?? "none");
  await clickWhenThere(dest);
  const fare = await textWhen('[role="dialog"]', /the ride takes about \d/);
  check("…the fare and the next train", /that's \d+ coins\. The next train leaves in/.test(fare ?? ""), fare?.slice(0, 160));
  check("…pay", await clickWhenThere("Pay ·"));
  const ticket = await textWhen('[role="dialog"]', /Here's your ticket/);
  const trip = (await admin.from("transit_trips").select("mode, to_name, fare").eq("user_id", id).is("ended_at", null).maybeSingle()).data;
  check("the ticket: the trip begins (the server's desk check passed)", /Here's your ticket/.test(ticket ?? "") && trip?.mode === "train", JSON.stringify(trip) + " · " + (ticket ?? "").slice(-120));
  await page.screenshot({ path: `${OUT}/ticketnear-3-ticket.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
