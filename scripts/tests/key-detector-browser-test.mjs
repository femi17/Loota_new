// The metal detector and the key's chest (phone), in a throwaway hunt: in the key's area the heat chip and the glowing
// edges; 30 m away the chest rises and "Open the chest" starts the Key Trial; answered right, the key flies to the bag.
// The hunt and the test player are deleted.   SHOTS=<folder> node scripts/tests/key-detector-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
const ids = [];
let huntId = null;
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

/** The answer to a maths prompt like "36 + 32 = ?". */
function solve(prompt) {
  const m = /(\d+)\s*([+−\-×x÷/])\s*(\d+)/.exec(prompt);
  if (!m) return null;
  const a = +m[1], b = +m[3];
  return { "+": a + b, "−": a - b, "-": a - b, "×": a * b, x: a * b, "÷": a / b, "/": a / b }[m[2]];
}

// The key: a spot on a road in Yaba (a bus stop stands by the road).
const spot = { lng: 3.378214, lat: 6.500147 };
const fromSpot = (m) => ({ lng: spot.lng, lat: spot.lat + m / 110574 });
try {
  const email = `detector-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  const start = fromSpot(600);
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Detector test (automated)", prize: "none", winners: 3, starts_at: ago(600), ends_at: soon(7200), published: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert([
    { hunt_id: huntId, n: 1, riddle: "The test key, by a bus stop in Yaba.", category: "maths", area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, approach_clue: "Near the bus stop.", spot_lng: spot.lng, spot_lat: spot.lat },
    { hunt_id: huntId, n: 2, riddle: "The second test key.", category: "maths", area_lng: 3.39, area_lat: 6.53, area_radius_m: 800, spot_lng: 3.39, spot_lat: 6.53 },
  ]);
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((h) => {
    try { localStorage.setItem(`loota:riddle-seen:${h}`, "1"); } catch {}
    window.__flew = false;
    new MutationObserver(() => { if (document.querySelector(".loota-key-fly")) window.__flew = true; }).observe(document, { subtree: true, childList: true });
  }, huntId);
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const shot = (name) => page.screenshot({ path: `${OUT}/detector-${name}.png` });
  const heatChip = () => page.evaluate(() => document.querySelector('[aria-label^="The key\'s heat"]')?.textContent ?? null);
  const open = async () => {
    await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(20000);
  };

  // ---- In the area, 600 m off
  await open();
  const chip1 = await heatChip();
  check("in the key's area: the heat chip", !!chip1, chip1);
  check("…and the glowing edges", await page.evaluate(() => !!document.querySelector(".loota-heat")));
  await shot("1-area");

  // ---- 30 m off: the chest
  await page.goto("about:blank");
  await wait(1000);
  const close = fromSpot(25);
  await admin.from("player_positions").update({ lng: close.lng, lat: close.lat, updated_at: ago(30) }).eq("user_id", id);
  await open();
  const chip2 = await heatChip();
  check("on top of it: burning", /Burning|Hot/.test(chip2 ?? ""), chip2);
  const button = await page.evaluate(() => !![...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Open the key's chest"));
  check("the chest has risen: Open the chest", button);
  await shot("2-chest");

  // ---- Open it: the Key Trial; answer right
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Open the key's chest")?.click());
  await wait(3000);
  const trial = await text('[aria-label="Key Trial"]');
  check("the Key Trial starts", /Key Trial · Key 1/.test(trial ?? ""), trial);
  for (let q = 0; q < 2; q++) {
    const t = await page.evaluate(() => {
      const d = document.querySelector('[aria-label="Key Trial"]');
      return d ? { prompt: d.querySelector("p.font-display")?.textContent ?? "", choices: [...d.querySelectorAll("button")].map((b) => b.textContent) } : null;
    });
    if (!t) break;
    const answer = solve(t.prompt);
    const pick = t.choices.findIndex((c) => Number(c) === answer);
    await page.evaluate((i) => [...document.querySelector('[aria-label="Key Trial"]').querySelectorAll("button")][i]?.click(), Math.max(0, pick));
    await wait(2500);
  }
  const result = await text('[aria-label="Key Trial result"]');
  check("Key 1 earned", /Key 1 earned!/.test(result ?? ""), result);
  check("…and the key flies into the bag", await page.evaluate(() => window.__flew));
  await shot("3-key");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    const { error } = await admin.from("hunts").delete().eq("id", huntId);
    if (error) console.log("hunt cleanup failed:", error.message);
  }
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
