// The live race at the chest (owner, 24 Oct 2026): two hunters in the same key's puzzle trial see each other's
// progress. A throwaway hunt (Key 1: Sentries) and two test players in two browser sessions at the chest: A posts three
// sentries, B sees A's bar move; A finishes, B sees "Done!". The hunt and players are deleted.
//   SHOTS=<folder> node scripts/tests/trial-race-browser-test.mjs
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
const ids = [];
let huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const spot = { lng: 3.378214, lat: 6.500147 };

try {
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Race test (automated)", prize: "none", winners: 2, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert([{ hunt_id: huntId, n: 1, riddle: "Race key.", category: "maths", trial_kind: "sentries", area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, spot_lng: spot.lng, spot_lat: spot.lat },
    { hunt_id: huntId, n: 2, riddle: "Far key.", category: "maths", trial_kind: "sentries", area_lng: 3.45, area_lat: 6.6, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.6 }]);
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

  /** A hunter: a player at the chest, in their own browser session. */
  async function hunter(tag) {
    const email = `race-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const id = data.user.id;
    ids.push(id);
    await admin.from("profiles").update({ username: `Racer_${tag}${Date.now() % 1000}`, home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
    await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: ago(30) });
    await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
    await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
    const jar = new Map();
    const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
    await c.auth.signInWithPassword({ email, password });
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((h, uid) => {
      try {
        localStorage.setItem(`loota:riddle-seen:${h}`, "1");
        localStorage.setItem(`loota:welcome:${uid}`, "1");
        localStorage.setItem(`loota:story:${h}:start`, "1");
      } catch {}
    }, huntId, id);
    await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    return { id, page };
  }
  const openChest = async (page) => {
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Hunt"] button')].find((b) => b.textContent?.trim() === "Search here")?.click());
      await wait(1500);
      if (await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Key Trial"] [data-cell]'))) return true;
    }
    return false;
  };
  const tapCell = async (page, i) => {
    const box = await page.evaluate((k) => {
      const r = document.querySelector(`[role="dialog"][aria-label="Key Trial"] [data-cell="${k}"]`)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, i);
    if (box) await page.mouse.click(box.x, box.y);
  };
  const race = (page) => page.evaluate(() => document.querySelector('[aria-label="The race"]')?.innerText.split("\n").join(" | ") ?? null);

  const A = await hunter("A");
  const B = await hunter("B");
  await wait(20000);
  check("A at the chest: the puzzle", await openChest(A.page));
  check("B at the chest: the puzzle", await openChest(B.page));
  const { data: tA } = await admin.from("trial_attempts").select("solution, puzzle").eq("user_id", A.id).eq("status", "active").single();
  // A posts three sentries.
  for (const [row, col] of tA.solution.slice(0, 3).map((c, r) => [r, c])) {
    await tapCell(A.page, row * tA.puzzle.n + col);
    await tapCell(A.page, row * tA.puzzle.n + col);
  }
  const want = `${Math.round((3 / tA.puzzle.n) * 100)}%`; // three of n sentries
  let seen = null;
  for (let i = 0; i < 16 && !(seen ?? "").includes(want); i++) {
    await wait(500);
    seen = await race(B.page);
  }
  check(`B sees A's progress (${want})`, /Racer_A/.test(seen ?? "") && (seen ?? "").includes(want), seen ?? "nothing");
  await B.page.screenshot({ path: `${OUT}/race-B.png` });
  // A finishes.
  for (const [row, col] of tA.solution.slice(3).map((c, r) => [r + 3, c])) {
    await tapCell(A.page, row * tA.puzzle.n + col);
    await tapCell(A.page, row * tA.puzzle.n + col);
  }
  seen = null;
  for (let i = 0; i < 16 && !/Done!/.test(seen ?? ""); i++) {
    await wait(500);
    seen = await race(B.page);
  }
  check("…A finished first: B sees Done!", /Done!/.test(seen ?? ""), seen ?? "nothing");
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_bonuses").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and ${ids.length} test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
