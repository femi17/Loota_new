// Is a hunter faster on a phone than on a laptop? (owner, 28 Oct 2026: "super faster on mobile while laptop speed looks
// normal"). The same test player rides the same straight road (Cowper St, Palo Alto) holding ↑ for 10 s, once on a phone
// screen and once on a laptop screen; prints metres per second along the road, frames per second, and how fast the
// ground slides across the screen (screen widths per second). The test player is deleted.
//   node scripts/tests/speed-probe.mjs [mode]
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const mode = process.argv[2] ?? "bicycle";
const at = { lng: -122.146009794487, lat: 37.4399811145393 };
const SCREENS = [
  ["phone", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 18],
  ["laptop", { width: 1440, height: 900 }, 17],
];
let id = null, browser;
try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  for (const [name, viewport, zoom] of SCREENS) {
    const email = `speed-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    id = data.user.id;
    await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
    if (mode !== "walk") await admin.from("player_vehicles").insert({ user_id: id, kind: mode, fuel: 80, tyre: 100, engine: 100, lng: at.lng, lat: at.lat, in_use: true });
    await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode, energy: 100, updated_at: new Date().toISOString() });
    const jar = new Map();
    const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
    await c.auth.signInWithPassword({ email, password });
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
    await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
    const result = await page.evaluate(async () => {
      const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
      const pos = () => window.__lootaRoad?.();
      let frames = 0, run = true;
      const count = () => { frames++; if (run) requestAnimationFrame(count); };
      requestAnimationFrame(count);
      const down = new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", bubbles: true });
      window.dispatchEvent(down);
      document.dispatchEvent(down);
      await new Promise((r) => setTimeout(r, 2500)); // up to speed
      let prev = pos(), path = 0;
      frames = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 10000) {
        await new Promise((r) => setTimeout(r, 200));
        const p = pos();
        if (p && prev) path += metres(prev, p);
        prev = p;
      }
      const secs = (performance.now() - t0) / 1000;
      run = false;
      const up = new KeyboardEvent("keyup", { key: "ArrowUp", code: "ArrowUp", bubbles: true });
      window.dispatchEvent(up);
      document.dispatchEvent(up);
      return { mps: path / secs, fps: frames / secs, width: innerWidth, height: innerHeight };
    });
    // CSS pixels per metre at this zoom (MapLibre's 512-px tiles) and latitude.
    const pxPerM = (512 * 2 ** zoom) / (40075016.686 * Math.cos((at.lat * Math.PI) / 180));
    const pxps = result.mps * pxPerM;
    console.log(`${name.padEnd(6)} zoom ${zoom}: ${result.mps.toFixed(1)} m/s along the road · ${result.fps.toFixed(0)} fps · ground moves ${pxps.toFixed(0)} px/s = ${(pxps / result.height).toFixed(2)} screen heights/s (${result.width}×${result.height})`);
    await page.close();
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
    id = null;
  }
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}
