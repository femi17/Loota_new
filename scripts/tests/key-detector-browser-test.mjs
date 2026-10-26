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
// An answer already locked in for the first riddle (the riddle clock), far from any key: tests start at the chest.
const LOCKED = { guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 };
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

// The key: a spot on a road in Yaba (a bus stop stands by the road).
const spot = { lng: 3.378214, lat: 6.500147 };
const fromSpot = (m) => ({ lng: spot.lng, lat: spot.lat + m / 110574 });
try {
  const email = `detector-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  const start = fromSpot(600);
  await admin.from("profiles").update({ coins: 400, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Detector test (automated)", prize: "none", winners: 3, starts_at: ago(600), ends_at: soon(7200), published: true, all_day: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert([
    { hunt_id: huntId, n: 1, riddle: "The test key, by a bus stop in Yaba.", category: "maths", area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, approach_clue: "Near the bus stop.", spot_lng: spot.lng, spot_lat: spot.lat },
    { hunt_id: huntId, n: 2, riddle: "The second test key.", category: "maths", area_lng: 3.39, area_lat: 6.53, area_radius_m: 800, spot_lng: 3.39, spot_lat: 6.53 },
  ]);
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, ...LOCKED });

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
  check("…and Search here on the hunt card (only in the area)", await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Hunt"] button')].some((b) => b.textContent?.trim() === "Search here")));
  await shot("1-area");

  // ---- 🏆: only the leaderboard (no riddle under it)
  await page.evaluate(() => document.querySelector('[data-tool="leaderboard"]')?.click());
  await wait(2000);
  const boardCard = await text('section[aria-label="Hunt"]');
  check("🏆: the card shows only the leaderboard", /Leaderboard/i.test(boardCard ?? "") && /🗝 0/.test(boardCard ?? "") && !/test key, by a bus stop/.test(boardCard ?? ""), boardCard);
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Hunt"] button')].find((b) => b.textContent?.trim() === "Back to the riddle")?.click());
  await wait(800);
  check("…and back to the riddle", /test key, by a bus stop/.test((await text('section[aria-label="Hunt"]')) ?? ""));

  // ---- The metal detector, bought in the inventory (300 coins)
  await page.evaluate(() => document.querySelector('button[aria-label^="Inventory"]')?.click());
  await wait(1500);
  const offer = await text('[role="dialog"]');
  check("the inventory offers a metal detector for 300", /Metal detector/.test(offer ?? "") && /Buy · 300/.test(offer ?? ""), (offer ?? "").slice(0, 160));
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Buy · 300")?.click());
  await wait(2500);
  const owned = await text('[role="dialog"]');
  const { data: me } = await admin.from("profiles").select("coins, detector").eq("id", id).single();
  check("…bought: ✓ Yours, 100 coins left", /✓ Yours/.test(owned ?? "") && me.detector === true && Number(me.coins) === 100, `${me.detector} ${me.coins}`);
  await shot("1b-detector");

  // ---- 25 m off: the chest (it rises within 60 m; Open the chest within 40 m)
  await page.goto("about:blank");
  await wait(1000);
  const close = fromSpot(25);
  await admin.from("player_positions").update({ lng: close.lng, lat: close.lat, updated_at: ago(30) }).eq("user_id", id);
  await open();
  const { data: at } = await admin.from("player_positions").select("lng, lat").eq("user_id", id).single();
  const away = Math.round(Math.hypot((at.lng - spot.lng) * 111320 * Math.cos((spot.lat * Math.PI) / 180), (at.lat - spot.lat) * 110574));
  console.log(`(the hunter stands ${away} m from the spot)`);
  const chip2 = await heatChip();
  check("on top of it: burning", /Burning|Hot/.test(chip2 ?? ""), chip2);
  const button = await page.evaluate(() => !![...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Open the key's chest"));
  check("the chest has risen: Open the chest", button);
  const cues1 = await page.evaluate(() => window.__lootaCues ?? []);
  check("…heard: the detector beeping near the key, the drum roll as the chest rose (no heartbeat: not tired)", cues1.includes("beep") && cues1.includes("chest") && !cues1.includes("heartbeat"), [...new Set(cues1)].join(", "));
  await shot("2-chest");

  // ---- Open it with the hunt card put away (owner, 20 Oct 2026: nothing happened): the card comes back, the Key Trial starts
  await page.evaluate(() => document.querySelector('button[aria-label^="Hide the hunt"]')?.click());
  await wait(800);
  check("the hunt card put away", await page.evaluate(() => !document.querySelector('section[aria-label="Hunt"]')));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Open the key's chest")?.click());
  await wait(3000);
  const trial = await text('[aria-label="Key Trial"]');
  check("the Key Trial starts", /Key Trial · Key 1/.test(trial ?? ""), trial);
  // The right answers, from the attempt (the questions mix kinds: sums, memory, counting, words).
  const { data: attempt } = await admin.from("trial_attempts").select("questions").eq("user_id", id).order("started_at", { ascending: false }).limit(1).single();
  for (let q = 0; q < attempt.questions.length; q++) {
    // (A memory question shows its things first: the answers come once they're hidden.)
    for (let i = 0; i < 20 && (await page.evaluate(() => !!document.querySelector('[aria-label="Key Trial"] [aria-label="Memorise"]'))); i++) await wait(500);
    const choice = String(attempt.questions[q].choices[attempt.questions[q].answer]);
    await page.evaluate((c) => [...document.querySelector('[aria-label="Key Trial"]').querySelectorAll("button")].find((b) => b.textContent === c)?.click(), choice);
    await wait(2500);
  }
  await wait(1500); // (on the map the Keeper cheers before the key's card)
  const result = await text('[aria-label="Key Trial result"]');
  check("Key 1 earned", /Key 1 earned!/.test(result ?? ""), result);
  check("…and the key flies into the bag", await page.evaluate(() => window.__flew));
  check("…with a fanfare", (await page.evaluate(() => window.__lootaCues ?? [])).includes("key"));
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
