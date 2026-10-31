// Sprint and Cruise on a desktop screen (owner, 31 Oct 2026: "The sprint and cruise button clashes with icons on the
// right on desktop"). In a story hunt (the longest tools column: the scroll and the leaderboard too), at several
// laptop sizes (the player in a clan: its chat button too): no tool button may overlap Sprint or Cruise, and every tool stays on the screen.
// The hunt and test player are deleted.   SHOTS=<folder> node scripts/tests/desktop-controls-browser-test.mjs
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
let id = null, huntId = null, clan = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const SIZES = [[1280, 720], [1366, 768], [1440, 900], [1024, 640], [1366, 600], [1280, 560], [1536, 580]]; // the last three: a laptop browser with a bookmarks bar and the taskbar
const work = { keys: 1, writer: "test", designs: {}, decoys: {}, map: {}, spent: {}, done: true, log: [], skeleton: { title: "Desktop test", logline: "A test story.", villain: { name: "x", motive: "x" }, heroes: [], worldRules: [], chapters: [{ n: 0, title: "One", setting: "Here", beats: [], plants: [] }, { n: 1, title: "Two", setting: "There", beats: [], plants: [] }], keys: [] }, chapters: { 0: { text: "A first chapter.", leaks: [] }, 1: { text: "A second chapter.", leaks: [] } } };

try {
  const email = `desk-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: 3.3787, lat: 6.5186, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Desktop test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true, story: work, story_status: "ready" }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.3958, area_lat: 6.4541, area_radius_m: 1500, spot_lng: 3.3958, spot_lat: 6.4541, exact_m: 120 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "Somewhere", guess_lng: 3.3958, guess_lat: 6.4541 });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  clan = (await c.rpc("create_clan", { p_name: `Desk ${Date.now().toString(36)}`, p_crest: "🦁", p_colour: "#2EC4B6" })).data?.clan ?? null; // the clan chat button too
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
  }, huntId, id);
  for (const [w, h] of SIZES) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    for (let i = 0; i < 40 && !(await page.$('[data-tool="story"]') && await page.$('[data-tool="clan"]')); i++) await wait(500);
    await wait(1500);
    const r = await page.evaluate(() => {
      const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const tools = [...document.querySelectorAll('nav[aria-label="Tools"] button, nav[aria-label="Tools"] a')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ name: e.getAttribute("aria-label") ?? e.textContent?.trim(), ...box(e) }));
      const big = [...document.querySelectorAll("button")].filter((b) => /^(SPRINT|CRUISE)/.test(b.textContent?.trim() ?? "")).map((e) => ({ name: e.textContent?.trim().slice(0, 6), ...box(e) }));
      const hit = [];
      for (const a of tools) for (const b of big) if (a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t) hit.push(`${a.name} × ${b.name}`);
      const off = tools.filter((t) => t.b > innerHeight || t.t < 0).map((t) => t.name);
      return { tools: tools.length, hit, off };
    });
    check(`${w}×${h}: no tool covers Sprint or Cruise`, r.hit.length === 0, r.hit.join(", ") || `${r.tools} tools`);
    check(`${w}×${h}: every tool on the screen`, r.off.length === 0, r.off.join(", "));
    await page.screenshot({ path: `${OUT}/desktop-${w}x${h}.png` });
  }
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (clan) await admin.from("clans").delete().eq("id", clan);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
