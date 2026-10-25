// The riddle card and its clock on a phone (owner, 25 Oct 2026): a throwaway hunt; the hunter at home in Yaba. The
// card shows the riddle with "Where is it?" and 15 seconds, and nothing else of old (no "No typing", no "Key Trial:",
// no "Prize:" line; 🏆 at the top); the hunter can't walk; typing a place and picking it locks it in ("Your answer");
// missing the window: "Too slow!" and the wait; 🏆 opens the leaderboard; no landmarks button. Deleted after.
//   SHOTS=<folder> node scripts/tests/riddle-clock-browser-test.mjs
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
let id = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const home = { lng: 3.3787, lat: 6.5186 }; // Yaba
const key = { lng: 3.3958, lat: 6.4541 }; // Tafawa Balewa Square

try {
  const email = `clockb-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ username: `Clock${Date.now() % 100000}`, home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Clock card test (automated)", prize: "A golden mask", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "A square named after the first Prime Minister.", category: "maths", trial_kind: "sentries", area_lng: key.lng, area_lat: key.lat, area_radius_m: 800, spot_lng: key.lng, spot_lat: key.lat });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
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
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
  }, huntId, id);
  const card = () => page.evaluate(() => document.querySelector('section[aria-label="Hunt"]')?.innerText.split("\n").filter(Boolean).join(" | ") ?? null);
  const open = async () => {
    await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    for (let i = 0; i < 40; i++) {
      await wait(1000);
      if (/Where is it|Too slow|Your answer/.test((await card()) ?? "")) return;
    }
  };

  await open();
  let text = (await card()) ?? "";
  check("the riddle with \"Where is it?\" and the clock", /A square named after the first Prime Minister/.test(text) && /Where is it\? Name the place/.test(text) && /⏱ \d+s/.test(text), text);
  check("…none of the old lines (No typing, Key Trial:, Prize:)", !/No typing|Key Trial:|Prize:/.test(text));
  check("…🏆 at the top", await page.evaluate(() => !!document.querySelector('section[aria-label="Hunt"] button[aria-label="Leaderboard"]')));
  check("no landmarks button", !(await page.evaluate(() => !!document.querySelector('[data-tool="landmarks"]'))));
  const top = await page.evaluate(() => ({
    clock: document.querySelector('[role="timer"]')?.getAttribute("aria-label") ?? null,
    energy: document.querySelector('[role="meter"]')?.getAttribute("aria-label") ?? null,
    board: !!document.querySelector('[data-tool="leaderboard"]'),
  }));
  check("the hunt's clock at the top: \"Ends in 59:00\"", /^Ends in (\d+m|\d+:\d\d)/.test(top.clock ?? ""), top.clock);
  check("…energy as a ring", top.energy === "Energy 100 of 100", top.energy);
  check("…and 🏆 among the tools on the right", top.board);
  const { data: hp0 } = await admin.from("hunt_players").select("riddle_n, riddle_at, guess_n").eq("hunt_id", huntId).eq("user_id", id).single();
  check("the server started the clock when the riddle showed", hp0.riddle_n === 1 && !!hp0.riddle_at && hp0.guess_n === null, JSON.stringify(hp0));
  await page.screenshot({ path: `${OUT}/clock-1-answer.png` });

  // Can't walk while answering.
  const before = await page.evaluate(() => document.querySelector('[aria-label="Street"], .street-name')?.textContent ?? null);
  await page.keyboard.down("ArrowUp");
  await wait(2500);
  await page.keyboard.up("ArrowUp");
  const { data: pos } = await admin.from("player_positions").select("lng, lat").eq("user_id", id).single();
  check("…and the hunter stays put while answering", Math.abs(pos.lat - home.lat) < 0.0003 && Math.abs(pos.lng - home.lng) < 0.0003, `${pos.lat},${pos.lng} ${before ?? ""}`);

  // Type the place and pick it.
  await page.type('section[aria-label="Hunt"] input[type="search"]', "Tafawa Balewa Square", { delay: 20 });
  let picked = false;
  for (let i = 0; i < 16 && !picked; i++) {
    await wait(500);
    picked = await page.evaluate(() => {
      const b = document.querySelector('section[aria-label="Hunt"] [role="listbox"] button');
      b?.click();
      return !!b;
    });
  }
  check("a place found and picked", picked);
  let locked = false;
  for (let i = 0; i < 10 && !locked; i++) {
    await wait(500);
    locked = /Your answer:/.test((await card()) ?? "");
  }
  text = (await card()) ?? "";
  check("locked in: \"Your answer\"", locked, text);
  const { data: hp1 } = await admin.from("hunt_players").select("guess_n, guess_name").eq("hunt_id", huntId).eq("user_id", id).single();
  check("…saved on the server", hp1.guess_n === 1 && /Tafawa|Balewa/i.test(hp1.guess_name ?? ""), JSON.stringify(hp1));
  await page.screenshot({ path: `${OUT}/clock-2-locked.png` });

  // Missed the window: the wait.
  await admin.from("hunt_players").update({ guess_n: null, riddle_at: ago(25) }).eq("hunt_id", huntId).eq("user_id", id);
  await open();
  text = (await card()) ?? "";
  check("missed the 15 seconds: \"Too slow!\" and the wait", /Too slow!/.test(text) && /Your next chance to answer in \d+s/.test(text), text);
  await page.screenshot({ path: `${OUT}/clock-3-wait.png` });

  await page.evaluate(() => document.querySelector('[data-tool="leaderboard"]')?.click());
  await wait(2000);
  text = (await card()) ?? "";
  // Only the hunters and their keys (owner, 25 Oct 2026).
  const rows = await page.evaluate(() => [...document.querySelectorAll('[aria-label="The leaderboard"] li')].map((li) => li.innerText.split("\n").join(" | ")));
  check("🏆 on the right opens the leaderboard: hunters and their keys only", rows.length === 1 && /^Clock\d+ \| 🗝 0$/.test(rows[0] ?? "") && !/Prize|Next Key Trial/.test(text), JSON.stringify(rows));
  await page.screenshot({ path: `${OUT}/clock-4-board.png` });
  // The clock ticks (owner, 25 Oct 2026: "It has to show a clock counting down"), even with days to go.
  await admin.from("hunts").update({ ends_at: new Date(Date.now() + (2 * 86400 + 3 * 3600) * 1000).toISOString() }).eq("id", huntId);
  await open();
  const shown = () => page.evaluate(() => document.querySelector('[role="timer"]')?.innerText.split("\n").join(" ") ?? null);
  const t1 = await shown();
  await wait(2200);
  const t2 = await shown();
  check("the top clock: days on the label, the time ticking", /2 DAYS LEFT/i.test(t1 ?? "") && /0?3:0\d:\d\d|02:59:\d\d/.test(t1 ?? "") && t1 !== t2, `${t1} → ${t2}`);
  const fits = await page.evaluate(() => {
    const r = document.querySelector('[role="timer"]')?.getBoundingClientRect();
    const coins = document.querySelector('button[aria-label$="coins: buy more"]')?.getBoundingClientRect();
    const ring = document.querySelector('[role="meter"]')?.getBoundingClientRect();
    // Its box holds its words, and it doesn't touch the energy ring or the coins.
    const inner = [...(document.querySelector('[role="timer"]')?.children ?? [])].every((c) => c.getBoundingClientRect().width <= (r?.width ?? 0));
    return !!r && !!coins && !!ring && inner && r.left >= ring.right && r.right <= coins.left;
  });
  check("…and it fits the top bar", fits);
  await page.screenshot({ path: `${OUT}/clock-5-top.png`, clip: { x: 0, y: 0, width: 390, height: 70 } });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
