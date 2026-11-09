// Watches one real hunter on the broadcast for a while, frame by frame, and sums up how they're drawn: from their motion
// (their game's saved way and keyframes) or their saved spots, how far they move and turn each second, and screenshots.
// A throwaway admin account opens the broadcast on the dev server (the same database as the live site); it's deleted.
//   node scripts/tests/watch-hunter-probe.mjs <hunt id> <username> [seconds] (SHOTS=<folder>)
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const [huntId, name, secs = "60"] = process.argv.slice(2);
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null, browser;
try {
  const { data: who } = await admin.from("profiles").select("id").eq("username", name).single();
  const email = `watch-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ is_admin: true }).eq("id", id);
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  await page.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  await wait(3000);
  const frames = await page.evaluate(
    (uid, ms) =>
      new Promise((done) => {
        const out = [];
        let drawn = null;
        const t0 = performance.now();
        const step = (t) => {
          const all = window.__broadcastShown?.();
          const p = all?.[uid];
          if (p && all.drawnWall !== drawn) {
            drawn = all.drawnWall;
            out.push({ t: all.drawnWall, lng: p.lng, lat: p.lat, h: p.heading, motion: (all.moving ?? []).includes(uid), trip: (all.trips ?? []).includes(uid) });
          }
          if (t - t0 < ms) requestAnimationFrame(step);
          else done(out);
        };
        requestAnimationFrame(step);
      }),
    who.id, Number(secs) * 1000,
  );
  await page.screenshot({ path: `${OUT}/watch-${name}.png` });
  const k = 111320 * Math.cos(((frames[0]?.lat ?? 9) * Math.PI) / 180);
  for (let s = 0; s < Number(secs); s++) {
    const f = frames.filter((x) => x.t >= frames[0].t + s * 1000 && x.t < frames[0].t + (s + 1) * 1000);
    if (f.length < 2) { console.log(`${s}s: ${f.length} frames`); continue; }
    let dist = 0, turn = 0, maxTurn = 0;
    for (let i = 1; i < f.length; i++) {
      dist += Math.hypot((f[i].lng - f[i - 1].lng) * k, (f[i].lat - f[i - 1].lat) * 110574);
      const d = Math.abs(((f[i].h - f[i - 1].h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI);
      turn += d;
      maxTurn = Math.max(maxTurn, d);
    }
    console.log(`${s}s: ${f.length} frames, moved ${dist.toFixed(1)} m, turned ${turn.toFixed(0)}° (most in a frame ${maxTurn.toFixed(1)}°), ${f[0].motion ? "motion" : f[0].trip ? "trip" : "saved spots"} @ ${f.at(-1).lng.toFixed(5)},${f.at(-1).lat.toFixed(5)}`);
  }
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  process.exit(0);
}
