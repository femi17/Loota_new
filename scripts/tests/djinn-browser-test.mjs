// The Djinn's Wager in the browser (phone), played like a player: the lamp smokes, the Djinn speaks,
// the three rooms are solved by hand, the map is unrolled, a seal broken, and the way asked for.
// Uses the Wager that's on (doesn't change it); the test player is deleted.
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
const isPrime = (n) => n > 1 && [...Array(Math.max(0, Math.floor(Math.sqrt(n)) - 1)).keys()].every((i) => n % (i + 2) !== 0);
const holds = (rule, n) => (rule === "prime" ? isPrime(n) : rule === "three" ? n % 3 === 0 : rule === "four" ? n % 4 === 0 : n % 7 === 0);
const ids = [];
let browser;
try {
  const { data: live } = await admin.from("djinn_wagers").select("*").gt("ends_at", new Date().toISOString()).is("winner", null).limit(1);
  const w = live?.[0];
  if (!w) throw new Error("No Wager is on: summon one from /admin first");
  const { data: real } = await admin.from("djinn_sites").select("*").eq("id", w.real_site).single();

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const start = { lng: 3.3787, lat: 6.5186 };
  const email = `djinn-b-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ username: `Seeker_${Date.now() % 1000}`, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", updated_at: new Date().toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll("button")].find((y) => (y.textContent?.includes(x) || y.getAttribute("aria-label")?.includes(x)) && !y.disabled); b?.click(); return !!b; }, t);

  const lamp = await page.evaluate(() => { const b = document.querySelector("[data-tool=lamp]"); return { cls: b?.className.includes("loota-lamp-djinn"), label: b?.getAttribute("aria-label") }; });
  console.log("lamp smoking purple:", lamp.cls, "| hint:", await page.evaluate(() => document.querySelector('p[role="status"]')?.textContent ?? ""));
  await page.screenshot({ path: `${OUT}/djinn-lamp.png` });
  await page.evaluate(() => document.querySelector("[data-tool=lamp]")?.click());
  await wait(3500);
  console.log("summons:", (await text('[role="dialog"][aria-label="The Djinn"]'))?.slice(0, 500));
  await page.screenshot({ path: `${OUT}/djinn-summons.png` });

  // ---- The gate
  console.log("face the gate:", await clickText("Face the gate"));
  await wait(2500);
  // Room I: turn the wheel the right number of times.
  const enc = w.gate.cipher.text, ans = w.gate.cipher.answer;
  const shift = (((enc.charCodeAt(0) - ans.charCodeAt(0)) % 26) + 26) % 26;
  for (let i = 0; i < shift; i++) await clickText("Turn the wheel on");
  await wait(300);
  console.log("wheel reads:", await page.evaluate(() => document.querySelector('[aria-label="What the wheel reads"]')?.textContent), "(answer", ans + ")");
  await page.screenshot({ path: `${OUT}/djinn-cipher.png` });
  // Room II: step across the floor.
  await clickText("II · Floor");
  await wait(300);
  const grid = w.gate.floor.grid;
  const path = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[grid.length - 1 - r];
    path.push(row.findIndex((n, col) => holds(w.gate.floor.rule, n) && (r === 0 || Math.abs(col - path[r - 1]) <= 1)));
  }
  for (let r = 0; r < path.length; r++) {
    const n = grid[grid.length - 1 - r][path[r]];
    await page.evaluate((num) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent === String(num) && !x.disabled); b?.click(); }, n);
    await wait(150);
  }
  console.log("floor:", await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] span')].find((s) => s.textContent?.includes("rows crossed"))?.textContent));
  await page.screenshot({ path: `${OUT}/djinn-floor.png` });
  // Room III: the scales.
  await clickText("III · Scales");
  await wait(300);
  const wts = w.gate.scales.weights;
  let stones = [];
  for (let m = 1; m < 64 && !stones.length; m++) {
    const pick = [0, 1, 2, 3, 4, 5].filter((i) => m & (1 << i));
    if (pick.reduce((s, i) => s + wts[i], 0) === w.gate.scales.target) stones = pick;
  }
  for (const i of stones) {
    await page.evaluate((idx) => { const b = [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')][idx]; b?.click(); }, i);
    await wait(150);
  }
  console.log("scales:", await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] p')].find((p) => p.textContent?.includes(" of "))?.textContent));
  await page.screenshot({ path: `${OUT}/djinn-scales.png` });
  console.log("speak:", await clickText("Speak to the Djinn"));
  await wait(3000);
  console.log("verdict:", (await text('[role="dialog"][aria-label="The Djinn"]'))?.slice(0, 300));
  await page.screenshot({ path: `${OUT}/djinn-verdict.png` });

  // ---- The map
  console.log("unroll:", await clickText("Unroll the map"));
  await wait(3000);
  console.log("map:", (await text('[role="dialog"][aria-label="The Djinn"]'))?.slice(0, 400));
  await page.screenshot({ path: `${OUT}/djinn-seals.png` });
  const broke = await page.evaluate((verse) => { const b = [...document.querySelectorAll('[role="dialog"] li button')].find((x) => x.textContent?.includes(verse.slice(0, 40))); b?.click(); return !!b; }, real.verse);
  await wait(500);
  console.log("chose the real seal:", broke, "| confirm:", await clickText("Break it"));
  await wait(3000);
  console.log("chosen:", (await text('[role="dialog"][aria-label="The Djinn"]'))?.slice(0, 400));
  await page.screenshot({ path: `${OUT}/djinn-chosen.png` });
  console.log("show the way:", await clickText("Show me the way"));
  await wait(9000);
  console.log("journey:", (await text('[role="dialog"][aria-label="Plan the journey"]'))?.slice(0, 500));
  await page.screenshot({ path: `${OUT}/djinn-journey.png` });
  console.log("browser errors:", problems.length ? problems.join(" | ") : "none");
} catch (e) {
  console.log("ERROR", e.message);
} finally {
  await browser?.close().catch(() => {});
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log("test players deleted:", ids.length);
}
