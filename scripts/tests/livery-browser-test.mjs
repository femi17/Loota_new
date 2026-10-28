// The Loota livery (owner, 26 Oct 2026: "let's brand our bus, trains, and plane... ads for investors"), on a phone:
// a test player waits for a bus, then a train, then a plane, each pulling in beside them; screenshots of each (to look
// at), and no page errors (the logo textures load). The trips and the test player are deleted.
//   SHOTS=<folder> node scripts/tests/livery-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const home = { lng: 3.3787, lat: 6.5186 }; // Club Rd, Yaba
const to = { lng: 3.3787, lat: 6.5286 };

try {
  const email = `livery-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });

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
  const missing = [];
  page.on("response", (r) => { if (/\/brand\/loota-/.test(r.url()) && r.status() >= 400) missing.push(r.url()); });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, id);

  for (const [mode, wait_s, visible_s] of [["bus", 30, 6], ["train", 30, 6], ["plane", 40, 20]]) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    const { error } = await admin.from("transit_trips").insert({
      user_id: id, mode, from_name: "Here", to_name: "There", to_lng: to.lng, to_lat: to.lat,
      path: [[home.lng, home.lat], [to.lng, to.lat]], path_m: 1100, fare: 0,
      departs_at: soon(wait_s), arrives_at: soon(wait_s + 120), ride_s: 120,
    });
    if (error) throw error;
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    // Until the vehicle has pulled in (it shows for the last few seconds of the wait).
    let left = Infinity;
    for (let i = 0; i < 60 && left > visible_s - 2; i++) {
      await wait(1000);
      // On a phone the trip folds to an icon after a moment: tap it open (it then stays open).
      const status = await page.evaluate(() => {
        const pill = document.querySelector('[data-pill="ride"]');
        if (pill && pill.getAttribute("aria-expanded") !== "true") pill.click();
        return document.querySelector('[aria-label="Your trip"]')?.innerText ?? "";
      });
      const m = /leaves in (?:(\d+) min )?(\d+) s/.exec(status);
      if (m) left = (+(m[1] ?? 0)) * 60 + +m[2];
    }
    check(`${mode}: pulled in at the stop`, left <= visible_s, `${left} s to go`);
    await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
    if (mode === "plane") {
      // The departure lounge first (its plane is branded too), then the map, where the plane waits at the gate.
      await page.screenshot({ path: `${OUT}/livery-lounge.png` });
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Look at the map/.test(b.textContent ?? ""))?.click());
      await wait(1000);
    }
    await page.screenshot({ path: `${OUT}/livery-${mode}.png` });
  }
  check("the logo images loaded", missing.length === 0, missing.join(", "));
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
}
