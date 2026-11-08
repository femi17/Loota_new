// The map on a phone held sideways (owner, 8 Nov 2026: "on mobile, when a user clicks on free roam or joins a hunt, can
// we make the hunt/play page a landscape mode in fullscreen"): screenshots in free roam and in a hunt, at a phone's
// landscape size, to check the layout. The test hunt and player are deleted.
//   SHOTS=<folder> node scripts/tests/landscape-shots.mjs
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
const HOME = { lng: 3.3787, lat: 6.5186 };
let id = null, huntId = null, browser;

try {
  const email = `land-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString(), cruise_tokens: 3 }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: HOME.lng, lat: HOME.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt } = await admin.from("hunts").insert({ title: "Landscape test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where the lagoon meets the bridge, under the third lamp.", category: "general", trial_kind: "puzzle", area_lng: 3.39, area_lat: 6.50, area_radius_m: 1500, spot_lng: 3.39, spot_lat: 6.50, exact_m: 300 });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const shoot = async (path, name) => {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.emulate({ viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" });
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(20000);
    await page.screenshot({ path: `${OUT}/landscape-${name}.png` });
    console.log("shot", name);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Skip/.test(b.textContent ?? ""))?.click());
      await wait(1500);
    }
    await wait(3000);
    await page.screenshot({ path: `${OUT}/landscape-${name}-2.png` });
    await page.evaluate(() => document.querySelector('button[aria-label^="Inventory"]')?.click());
    await wait(1500);
    await page.screenshot({ path: `${OUT}/landscape-${name}-panel.png` });
    await page.close();
  };
  await shoot("/play", "free-roam");
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  await shoot(`/play?hunt=${huntId}`, "hunt");
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log("deleted");
}
