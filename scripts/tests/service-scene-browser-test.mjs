// Servicing at a mechanic's as a scene on the map (phone; owner, 19 Oct 2026: "servicing of motorbike was not a scene
// and it was fast"): riding a motorbike with a worn engine (60%) to a mechanic, Service opens the open workshop (the
// motorbike on the stand, the mechanic); "Go ahead" starts the job and the work bar runs about 35 seconds before the
// engine is like new (60 coins, charged at the end); halfway nothing is done or paid yet. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/service-scene-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const { data: shop } = await admin.from("places").select("name, lng, lat").eq("kind", "mechanic").gte("lng", 3.36).lte("lng", 3.40).gte("lat", 6.49).lte("lat", 6.53).limit(1).single();
  const email = `service-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: shop.lng, home_lat: shop.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 200, p_kind: "admin", p_reason: "Service scene test" });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 80, tyre: 100, engine: 60, lng: shop.lng, lat: shop.lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: shop.lng, lat: shop.lat, mode: "motorbike", energy: 100, updated_at: ago(30) });
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
  const text = () => page.evaluate((nl) => document.querySelector('[role="dialog"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const shot = (name) => page.screenshot({ path: `${OUT}/service-${name}.png` });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const engine = async () => (await admin.from("player_vehicles").select("engine").eq("user_id", id).single()).data.engine;
  const until = async (re, tries = 40) => {
    let t = null;
    for (let i = 0; i < tries && !re.test(t ?? ""); i++) {
      await wait(500);
      t = await text();
    }
    return t;
  };
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);

  const tapped = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.includes("Service · 60"));
    b?.click();
    return !!b;
  });
  check(`at ${shop.name} on a worn motorbike: a Service button`, tapped);
  const greet = await until(/about 35 seconds/);
  check("…the mechanic: engine at 60%, 60 coins, about 35 seconds", /engine is at 60%.*60 coins, about 35 seconds/.test(greet ?? ""), greet);
  check("…in the open workshop on the map", (await page.evaluate(() => document.querySelector('[role="dialog"]')?.getAttribute("aria-label"))) === `Servicing at ${shop.name}`);
  await shot("1-greet");
  const c0 = await coins();
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.startsWith("Go ahead"))?.click());
  await wait(15000);
  const mid = await text();
  check("15 s in: still working, nothing done or paid", /Ready in 0:(1\d|2\d)/.test(mid ?? "") && (await coins()) === c0 && Math.round(await engine()) <= 60, mid);
  await shot("2-working");
  const done = await until(/runs like new/, 60);
  check("…about 35 s: like new, 60 coins", /runs like new/.test(done ?? "") && (await engine()) === 100 && (await coins()) === c0 - 60, `${await engine()} · ${c0 - (await coins())}`);
  await shot("3-done");
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.startsWith("Thank you"))?.click());
  await wait(1500);
  check("…and walks out", (await page.$('[role="dialog"]')) === null);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
