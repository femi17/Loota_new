// On a phone (owner, 26 Oct 2026): another hunter picks up a relic on the map, and this player's map shows it as news
// within seconds ("… picked up 🛡️ a Shield!"); the leaderboard tool is drawn like the others (a line icon, not an
// emoji) and lights up gold when another hunter takes a key in the hunt, until it's opened. The test hunt, players and
// the find are deleted.
//   SHOTS=<folder> node scripts/tests/news-board-browser-test.mjs
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
const later = (s) => new Date(Date.now() + s * 1000).toISOString();
const ids = [];
let itemId = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const yaba = { lng: 3.3787, lat: 6.5186 };
const cell = `${Math.floor(yaba.lng / 0.005)}:${Math.floor(yaba.lat / 0.005)}`;

async function player(tag) {
  const email = `${tag.toLowerCase()}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  const name = `${tag}${String(Date.now()).slice(-5)}`;
  await admin.from("profiles").update({ username: name, home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: ago(60) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: later(3600), created_at: later(3600) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  return { id, name, jar, rpc: async (fn, args) => (await c.rpc(fn, args)).data };
}

try {
  const finder = await player("Finder");
  const watcher = await player("Watcher");
  // A test hunt (all day, so the 9pm pause doesn't stop it), both of them in it.
  const { data: hunt, error: hErr } = await admin.from("hunts")
    .insert({ title: "News test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: later(86400), published: true, all_day: true })
    .select("id").single();
  if (hErr) throw hErr;
  huntId = hunt.id;
  for (const n of [1, 2]) await admin.from("hunt_keys").insert({ hunt_id: huntId, n, riddle: "Test key.", category: "maths", trial_kind: "sentries", area_lng: 3.3958, area_lat: 6.4541, area_radius_m: 800, spot_lng: 3.3958, spot_lat: 6.4541 });
  for (const p of [finder, watcher]) await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: p.id, guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...watcher.jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, watcher.id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000); // the map, and the news clock set

  // ---- Someone else picks up a Shield
  const { data: it, error } = await admin.from("world_items").insert({ cell, kind: "relic", relic: "shield", lng: yaba.lng, lat: yaba.lat, expires_at: later(3600) }).select("id").single();
  if (error) throw error;
  itemId = it.id;
  const picked = await finder.rpc("pickup_item", { p_item: it.id, p_lng: yaba.lng, p_lat: yaba.lat, p_mode: "walk" });
  check("another hunter picked up a Shield", picked?.ok === true, JSON.stringify(picked));
  const news = () => page.evaluate(() => document.querySelector('[aria-label="News"]')?.innerText ?? "");
  let shown = "";
  for (let i = 0; i < 40 && !shown.includes("picked up"); i++) {
    await wait(500);
    shown = await news();
  }
  check("…and this player's map shows it as news", shown.includes(`${finder.name} picked up 🛡️ a Shield!`), shown);
  await page.screenshot({ path: `${OUT}/news-1-shield.png` });

  // ---- The leaderboard tool
  const board = () => page.evaluate(() => {
    const b = document.querySelector('[data-tool="leaderboard"]');
    return b ? { label: b.getAttribute("aria-label"), cls: b.className, svg: !!b.querySelector("svg"), text: b.textContent.trim() } : null;
  });
  const b0 = await board();
  check("the leaderboard: a line icon like the other tools (no emoji)", !!b0 && b0.svg && b0.text === "" && /bg-ink/.test(b0.cls), JSON.stringify(b0));
  // The other hunter takes Key 1.
  const { error: tErr } = await admin.from("trial_attempts").insert({ hunt_id: huntId, user_id: finder.id, key_n: 1, questions: [], status: "passed", started_at: ago(20), ended_at: new Date().toISOString() });
  if (tErr) throw tErr;
  await admin.from("hunt_players").update({ keys_held: 1, last_key_at: new Date().toISOString() }).eq("hunt_id", huntId).eq("user_id", finder.id);
  let b1 = b0;
  for (let i = 0; i < 30 && !/bg-gold/.test(b1?.cls ?? ""); i++) {
    await wait(1000);
    b1 = await board();
  }
  check("another hunter takes a key: it lights up gold", /bg-gold/.test(b1?.cls ?? "") && /a key was just taken/.test(b1?.label ?? ""), JSON.stringify(b1));
  await page.screenshot({ path: `${OUT}/news-2-board-lit.png` });
  await page.evaluate(() => document.querySelector('[data-tool="leaderboard"]')?.click());
  await wait(800);
  const b2 = await board();
  check("opened: back to normal", !!b2 && !/bg-gold/.test(b2.cls) && b2.label === "Leaderboard", JSON.stringify(b2));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (itemId) await admin.from("world_items").delete().eq("id", itemId);
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test hunt, find and test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
