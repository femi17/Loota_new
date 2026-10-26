// The jerry can only when the fuel runs out (owner, 26 Oct 2026: "remove the jerry can totally… not needed… except when
// fuel finishes"). Riding a motorbike with 20% in the tank and a jerry can of fuel: no badge on ⛽, no Pour anywhere.
// Its tank run dry (the motorbike in the pocket, empty): "Pour can", and the scene: the hunter beside the bike, the can
// at 77% and the tank at 0%; "Pour it in": the can down to what's left, the tank at 50%; Ride on. The test player is
// deleted.
//   SHOTS=<folder> node scripts/tests/jerry-can-when-dry-browser-test.mjs
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
  const email = `pour-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ coins: 100, home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "motorbike", energy: 100, updated_at: ago(30) });
  const { error: vErr } = await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 20, tyre: 100, engine: 100, lng: home.lng, lat: home.lat, in_use: true, helmet: true, registered: true });
  if (vErr) throw vErr;
  await admin.from("player_kegs").upsert({ user_id: id, fuel: 50, uses_left: 10 });
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
  const pourButtons = () =>
    page.evaluate(() => [...document.querySelectorAll("button")].filter((x) => /Pour/.test(x.textContent ?? "") || /Pour the jerry can/.test(x.getAttribute("aria-label") ?? "")).map((x) => x.textContent?.trim()));
  let gauge = null;
  for (let i = 0; i < 40 && !gauge; i++) {
    await wait(1000);
    gauge = await page.evaluate(() => document.querySelector('[title="Fuel"]')?.textContent ?? null);
  }
  check("riding with fuel: the gauge, and no jerry can badge", /20%/.test(gauge ?? "") && !(await page.evaluate(() => !!document.querySelector('[data-badge="jerry-can"]'))), gauge);
  check("…and no Pour anywhere", (await pourButtons()).length === 0, JSON.stringify(await pourButtons()));
  await page.screenshot({ path: `${OUT}/pour-1-gauge.png`, clip: { x: 0, y: 0, width: 390, height: 220 } });

  // The tank runs dry: the motorbike in the pocket, empty.
  await admin.from("player_vehicles").update({ fuel: 0, in_use: false }).eq("user_id", id);
  await admin.from("player_positions").update({ mode: "walk", updated_at: ago(30) }).eq("user_id", id);
  await page.reload({ waitUntil: "domcontentloaded" });
  let pour = [];
  for (let i = 0; i < 40 && !pour.length; i++) {
    await wait(1000);
    pour = await pourButtons();
  }
  check("its tank empty: Pour can", pour.some((x) => /Pour can/.test(x ?? "")), JSON.stringify(pour));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Pour can/.test(x.textContent ?? ""))?.click());
  await wait(1200);
  const NL = String.fromCharCode(10);
  const sceneText = () => page.evaluate((nl) => document.querySelector('[role="dialog"][aria-label="Pouring the jerry can"]')?.innerText.split(nl).filter(Boolean).join(" | ") ?? null, NL);
  let scene = await sceneText();
  check("the scene: off the bike, the can at 77%, the tank at 0%", /Topping up your motorbike/.test(scene ?? "") && /Jerry can \| 77%/.test(scene ?? "") && /Tank \| 0%/.test(scene ?? "") && /get off/.test(scene ?? ""), scene);
  await page.screenshot({ path: `${OUT}/pour-2-scene.png` });
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes("Pour it in"))?.click());
  await wait(1200);
  await page.screenshot({ path: `${OUT}/pour-3-pouring.png` });
  for (let i = 0; i < 10 && !/Ride on/.test(scene ?? "") ; i++) {
    await wait(500);
    scene = await sceneText();
  }
  check("poured: the can empty, the tank at 50%, Ride on", /Jerry can \| 0%/.test(scene ?? "") && /Tank \| 50%/.test(scene ?? "") && /50% fuel/.test(scene ?? "") && /Ride on/.test(scene ?? ""), scene);
  await page.screenshot({ path: `${OUT}/pour-4-done.png` });
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Ride on")?.click());
  await wait(800);
  check("Ride on: the scene closes", !(await sceneText()));
  let fuel = 0;
  for (let i = 0; i < 10 && fuel <= 0; i++) {
    await wait(1000);
    fuel = (await admin.from("player_vehicles").select("fuel").eq("user_id", id).eq("kind", "motorbike").single()).data.fuel;
  }
  check("the tank filled from the can", Math.round(fuel) === 50, `${Math.round(fuel)}%`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.from("player_kegs").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
