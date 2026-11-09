// Is the live site's game saving motion for the broadcast? A throwaway hunter in a throwaway live hunt opens the game on
// the live site (a phone); the game saves its clock check at once (a hunter_motion row with no way); then it taps a spot
// and goes there by themselves, and the way and keyframes should follow. Prints what was saved. The hunt and the
// accounts are deleted.   SITE=https://loota-plum.vercel.app node scripts/tests/live-site-motion-probe.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const SITE = process.env.SITE ?? "https://loota-plum.vercel.app";
const HOST = new URL(SITE).hostname;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const start = { lng: 3.3787, lat: 6.5186 };
let id = null, huntId = null, browser;
try {
  const email = `liveprobe-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ username: `Probe${Date.now() % 1000}`, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Live motion probe (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.30, area_lat: 6.60, area_radius_m: 500, spot_lng: 3.30, spot_lat: 6.60 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, joined_at: ago(60) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("response", (r) => { if (/motion_put/.test(r.url())) errs.push(`motion_put → ${r.status()}`); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: HOST, path: "/", secure: true })));
  await page.evaluateOnNewDocument((uid, h) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); localStorage.setItem(`loota:riddle-seen:${h}`, "1"); localStorage.setItem(`loota:story:${h}:start`, "1"); sessionStorage.setItem("loota:fs-offered", "1"); } catch {} }, id, huntId);
  await page.goto(`${SITE}/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  const row1 = (await admin.from("hunter_motion").select("way_id, keys, updated_at").eq("user_id", id).maybeSingle()).data;
  console.log("after loading the game: motion row", row1 ? `yes (way ${row1.way_id ?? "none"})` : "NONE: the live game isn't the new version");
  console.log("calls seen:", errs.join(" / ") || "none");
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) {
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log("hunt and test account deleted");
  process.exit(0);
}
