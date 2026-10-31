// The penalty card and "This is the place" on the map, on a phone (owner, 31 Oct 2026). The server's answers are set
// for the test (its rules are checked in exact-key-api-test): a story key's wrong place with a coins penalty, then the
// right place.
//   1. The trap fills the screen: its title, its story, what it cost; the coins on the top bar drop; Get up closes it.
//   2. At the right place: "📍 This is the place", no hot-and-cold glow.
// The hunt and test player are deleted.   SHOTS=<folder> node scripts/tests/penalty-card-browser-test.mjs
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
  const email = `penalty-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString(), coins: 1000 }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Penalty test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where was the light?", category: "general", trial_kind: "sentries", area_lng: 3.3958, area_lat: 6.4541, area_radius_m: 1500, spot_lng: 3.3958, spot_lat: 6.4541, exact_m: 120 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "Test answer", guess_lng: home.lng, guess_lat: home.lat });

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
  // The server's pulse, as the test needs it: first the wrong place with a coins penalty, then the right place.
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
    window.__pulse = "wrong";
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const u = typeof input === "string" ? input : input.url;
      if (!u.includes("/rpc/key_pulse")) return realFetch(input, init);
      const body = window.__pulse === "wrong"
        ? { ok: true, key: 1, inArea: false, wrongPlace: "Galle Fort Hotel", detector: false, penalty: { code: "deep-26-coins-1", tier: "deep", title: "The Masquerade's tea", body: "A kind stranger offers you a glass of sweet tea. You only remember the first sip. You come round. Your bag is open and 50 coins are missing.", scene: "masquerade", effect: "coins", amount: 50, balance: 950, energy: null, moveTo: null, until: null } }
        : window.__pulse === "right"
          ? { ok: true, key: 1, inArea: true, exact: true, near: true, spot: { lng: 3.3787, lat: 6.5186, scene: "circle" }, detector: false, clue: "This is the place." }
          : { ok: true, key: 1, inArea: false, detector: false };
      if (window.__pulse === "wrong") window.__pulse = "quiet";
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
  }, huntId, id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });

  let card = null;
  for (let i = 0; i < 60 && !card; i++) {
    await wait(1000);
    card = await page.evaluate(() => document.querySelector('[role="alertdialog"][data-penalty]')?.innerText ?? null);
  }
  check("the wrong place: the trap fills the screen (title, story, cost)", !!card && /WRONG PLACE/i.test(card) && card.includes("The Masquerade's tea") && card.includes("first sip") && card.includes("−50 coins"), card?.replace(/\s+/g, " ").slice(0, 160));
  const coins = await page.evaluate(() => document.body.innerText.match(/\b950\b/) !== null);
  check("…the coins on the top bar drop to 950", coins);
  await page.screenshot({ path: `${OUT}/penalty-1-card.png` });
  await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => /Get up/.test(b.textContent ?? ""))?.click());
  await wait(500);
  check("Get up closes it", !(await page.$('[role="alertdialog"][data-penalty]')));

  await page.evaluate(() => { window.__pulse = "right"; });
  let place = false;
  for (let i = 0; i < 30 && !place; i++) {
    await wait(1000);
    place = await page.evaluate(() => !!document.querySelector('[aria-label="This is the place"]'));
  }
  const glow = await page.evaluate(() => [...document.querySelectorAll("[aria-label^=\"The key's heat\"]")].length);
  check("the right place: 📍 This is the place, and no hot-and-cold", place && glow === 0, `badge ${place}, heat chips ${glow}`);
  await page.screenshot({ path: `${OUT}/penalty-2-place.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
