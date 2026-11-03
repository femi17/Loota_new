// Thrown away from a story key, nothing of the place stays (owner, 3 Nov 2026: "when I was thrown away, I can still
// see explore the place from 2km away, and if I open it, it is blank… this is the place indication is also on the
// screen"). A hunter at a story key's place (phone): "📍 This is the place" and "🧭 Explore the place". The server then
// moves them 2 km back (as a quarter trap that sends you back does: deal_penalty's 'back'): on their screen they're
// there too, and the chip and the button go. And the place opened from too far: it closes with why (never blank).
// The hunt and the test player are deleted.   SHOTS=<folder> node scripts/tests/thrown-away-browser-test.mjs
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
const PLACE = { lng: 3.3958, lat: 6.4541 };
const BACK = { lng: 3.3787, lat: 6.4700 }; // about 2 km away, on a road
const HOUSE = { title: "The test quarter", style: "lagos", layout: "court", items: {}, rooms: [
  { id: "well", name: "The old well", kind: "cellar", role: "right" },
  { id: "stall", name: "The food stall", kind: "kitchen", role: "trap" },
  { id: "garden", name: "The garden", kind: "study", role: "safe" },
] };

try {
  const email = `thrown-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500 }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Thrown away test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng, area_lat: PLACE.lat, area_radius_m: 1500,
    spot_lng: PLACE.lng, spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "The place", guess_lng: PLACE.lng, guess_lat: PLACE.lat, leg_lng: BACK.lng, leg_lat: BACK.lat });

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
  const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
  const shows = () => page.evaluate(() => ({
    chip: !!document.querySelector('[aria-label="This is the place"]'),
    explore: [...document.querySelectorAll("button")].some((b) => /Explore the place/.test(b.textContent ?? "")),
  }));
  const where = () => page.evaluate(() => window.__lootaPos?.() ?? null);
  const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const at = await until(async () => { const s = await shows(); return s.chip && s.explore ? s : null; }, 60000);
  check("at the place: 📍 This is the place and 🧭 Explore the place", !!at, JSON.stringify(await shows()));
  await page.screenshot({ path: `${OUT}/thrown-1-at-the-place.png` });

  // ---- The server sends them back 2 km (a quarter trap's 'back'); their screen still thinks they're at the place.
  await admin.from("player_positions").update({ lng: BACK.lng, lat: BACK.lat, updated_at: new Date().toISOString() }).eq("user_id", id);
  await page.keyboard.down("ArrowUp"); // they walk a step: the save is refused, and the server's spot wins
  await wait(1500);
  await page.keyboard.up("ArrowUp");
  const moved = await until(async () => { const p = await where(); return p && metres(p, BACK) < 300 ? p : null; }, 30000);
  check("sent back 2 km by the server: on their screen they're there too", !!moved, moved ? `${Math.round(metres(moved, BACK))} m from it` : JSON.stringify(await where()));
  const gone = await until(async () => { const s = await shows(); return !s.chip && !s.explore ? s : null; }, 20000);
  check("…and 'This is the place' and 'Explore the place' are gone", !!gone, JSON.stringify(await shows()));
  await page.screenshot({ path: `${OUT}/thrown-2-sent-back.png` });

  // ---- The place opened from too far (the server says no): closed, with why, never a blank scene
  await admin.from("player_positions").update({ lng: PLACE.lng, lat: PLACE.lat, updated_at: ago(30) }).eq("user_id", id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(async () => (await shows()).explore, 60000);
  await admin.from("player_positions").update({ lng: BACK.lng, lat: BACK.lat, updated_at: new Date().toISOString() }).eq("user_id", id);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Explore the place/.test(b.textContent ?? ""))?.click());
  const closed = await until(() => page.evaluate(() => !document.querySelector('[aria-label="The key\'s place"]') && /moved away from this place/.test(document.body.innerText)), 15000);
  check("opened from too far: it closes and says why (not a blank scene)", !!closed);
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
