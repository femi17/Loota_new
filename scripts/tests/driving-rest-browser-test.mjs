// Riding too long (owner, 26 Oct 2026: "tell them to go rest, they have been driving for too long"), on a phone: on a
// tired rider (energy under 50), a reminder to take a break, and a "Rest here" button (riders couldn't rest before);
// tapping it: "You pull over and rest by your motorbike", and the server marks the hunter resting. The test player is
// deleted.
//   SHOTS=<folder> node scripts/tests/driving-rest-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const home = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `driverest-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "motorbike", energy: 20, updated_at: ago(30) });
  const { error: vErr } = await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 80, tyre: 100, engine: 100, lng: home.lng, lat: home.lat, in_use: true, helmet: true, registered: true });
  if (vErr) throw vErr;
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
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const body = () => page.evaluate(() => document.body.innerText);
  let text = "";
  for (let i = 0; i < 40 && !/Time for a break|Pull over and rest|Too tired to go on/.test(text); i++) {
    await wait(1000);
    text = await body();
  }
  check("a tired rider: told to take a break", /Time for a break|Pull over and rest|Too tired to go on/.test(text), (text.match(/Time for a break|Pull over and rest|Too tired to go on/) ?? [""])[0]);
  const rest = await page.evaluate(() => !!document.querySelector('button[aria-label^="Pull over and rest right here"]'));
  check("…and a Rest here button (riders can rest now)", rest);
  await page.screenshot({ path: `${OUT}/driverest-1.png` });
  await page.evaluate(() => document.querySelector('button[aria-label^="Pull over and rest right here"]')?.click());
  let said = "";
  for (let i = 0; i < 10 && !/pull over and rest by your motorbike/.test(said); i++) {
    await wait(500);
    said = await body();
  }
  check("tapped: \"You pull over and rest by your motorbike\"", /You pull over and rest by your motorbike/.test(said));
  const { data: pos } = await admin.from("player_positions").select("resting_since").eq("user_id", id).single();
  check("…and the server has the hunter resting", !!pos?.resting_since);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
