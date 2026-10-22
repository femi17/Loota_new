// The lamp between hunts (owner, 22 Oct 2026: finds in free roam, smaller rewards): a player in no hunt opens the
// lamp and sees a Detour nearby at half its coins, marked as such. The test Detour and player are deleted.
//   SHOTS=<folder> node scripts/tests/lamp-free-roam-browser-test.mjs
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
let id = null, detourId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const yaba = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `lamp-free-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  // A Detour 300 m away in the player's area, ending before any other there (the lamp shows the soonest first).
  const { data: area } = await admin.rpc("detour_area", { p_lng: yaba.lng, p_lat: yaba.lat });
  const { data: d, error } = await admin.from("detours")
    .insert({ kind: "flash", area, title: "A test pouch", story: "Something fell off a danfo's roof.", place_name: "Tejuosho Market", lng: yaba.lng, lat: yaba.lat + 300 / 110574, reward_coins: 80, ends_at: new Date(Date.now() + 150e3).toISOString() })
    .select("id").single();
  if (error) throw error;
  detourId = d.id;

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
  await wait(20000);
  await page.evaluate(() => document.querySelector("[data-tool=lamp]")?.click());
  await wait(3500);
  if (await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="The Djinn"]'))) {
    await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="The Djinn"] button[aria-label="Close"]')?.click());
    await wait(800);
    await page.evaluate(() => document.querySelector("[data-tool=lamp]")?.click());
    await wait(3500);
  }
  const lamp = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
  // Ours, or a real one nearby ending sooner (the lamp shows one thing at a time).
  check("free roam: the lamp shows a Detour", /Flash|Rush/.test(lamp), lamp.slice(0, 160).split("\n").join(" | "));
  const reward = lamp.split("\n").find((l) => / · /.test(l) && /coins|relic/.test(l)) ?? "";
  check("…its coins halved and marked as such (a relic is given as is)", /coins\s*\(free roam: half\)/.test(reward) || /relic\)/.test(reward), reward);
  if (/A test pouch/.test(lamp)) check("…ours: 40 of its 80 coins", /40 coins\s*\(free roam: half\)/.test(reward));
  await page.screenshot({ path: `${OUT}/lamp-free-roam.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (detourId) await admin.from("detours").delete().eq("id", detourId);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test Detour and player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
