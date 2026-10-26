// The hunt resting for the night (owner, 26 Oct 2026: hunts run 9 am to 9 pm; free roam after), on a phone, at any hour:
// the page's clock is set to 10 pm Lagos time and the server's hunt state read as "paused" (the server's own rule is
// checked in hunt-hours-lamp-rest-api-test). The card: "🌙 The hunt rests from 9 pm to 9 am… Back in 11:00:00"-ish, no
// riddle; the top clock: "🌙 Back in"; the hunter can walk (free roam). The hunt and test player are deleted.
//   SHOTS=<folder> node scripts/tests/hunt-paused-browser-test.mjs
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
const home = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `paused-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Night test (automated)", prize: "none", winners: 1, starts_at: ago(3 * 86400), ends_at: new Date(Date.now() + 3 * 86400e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Night key.", category: "maths", trial_kind: "sentries", area_lng: 3.3958, area_lat: 6.4541, area_radius_m: 800, spot_lng: 3.3958, spot_lat: 6.4541 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });
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
  // 10 pm in Lagos on the page's clock, and the hunt read as resting.
  const real = new Date();
  const tenPm = Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), real.getUTCDate(), 21); // 22:00 Lagos
  await page.evaluateOnNewDocument((h, uid, offset) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + offset;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await realFetch(input, init);
      const u = typeof input === "string" ? input : input.url;
      if (!u.includes("/rpc/hunt_state")) return res;
      const body = await res.clone().json();
      if (body && typeof body === "object") Object.assign(body, { phase: "paused", riddle: null, trial: null });
      return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
    };
  }, huntId, id, tenPm - real.getTime());
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  let card = null;
  for (let i = 0; i < 40 && !/rests/.test(card ?? ""); i++) {
    await wait(1000);
    card = await page.evaluate(() => document.querySelector('section[aria-label="Hunt"]')?.innerText.split("\n").filter(Boolean).join(" | ") ?? null);
  }
  check("the card: resting from 9 pm to 9 am, back in about 11 h, no riddle", /back at 9 am/.test(card ?? "") && /The hunt rests from 9 pm to 9 am/.test(card ?? "") && /Back in 1[01]:\d\d:\d\d/.test(card ?? "") && !/Night key/.test(card ?? ""), card);
  const top = await page.evaluate(() => document.querySelector('[role="timer"]')?.innerText.split("\n").join(" ") ?? null);
  check("the top clock: 🌙 Back in, ticking", /BACK IN/i.test(top ?? "") && /1[01]:\d\d:\d\d/.test(top ?? ""), top);
  await page.screenshot({ path: `${OUT}/paused-1.png` });
  // Free roam: the hunter walks.
  await page.keyboard.down("ArrowUp");
  await wait(3500);
  await page.keyboard.up("ArrowUp");
  await wait(4000);
  const { data: pos } = await admin.from("player_positions").select("lng, lat").eq("user_id", id).single();
  check("free roam: the hunter walks (no riddle clock holding them)", Math.hypot((pos.lng - home.lng) * 110400, (pos.lat - home.lat) * 110574) > 3);
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
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
