// The message bar never under what can be done here (owner, 2 Nov 2026: the message was "showing under the action
// button, user cannot fully read what it says before it goes off"). On a phone (with the joystick), at the airport's
// check-in desk: while a message shows, it's on top and the 🛫 Check in button sits wholly above it.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/map-message-actions-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const { data: desk } = await admin.from("transit_stops").select("desk_lng, desk_lat").ilike("name", "%murtala%").not("desk_lng", "is", null).limit(1).single();
  const email = `msgact-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: desk.desk_lng, lat: desk.desk_lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });

  // Wait for the Check in button and a message at the same time.
  let seen = null;
  for (let t = 0; t < 120 && !seen; t++) {
    await wait(500);
    await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
    seen = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /Check in/.test(b.textContent ?? ""));
      const msg = document.querySelector('p[role="status"]');
      if (!btn || !msg || getComputedStyle(msg).visibility === "hidden" || !msg.textContent?.trim()) return null;
      const b = btn.getBoundingClientRect(), m = msg.getBoundingClientRect();
      const top = document.elementFromPoint(m.left + m.width / 2, m.top + 6);
      return { btnBottom: Math.round(b.bottom), msgTop: Math.round(m.top), msgOnTop: !!top && msg.contains(top), text: msg.textContent.trim().slice(0, 80) };
    });
  }
  await page.screenshot({ path: `${OUT}/map-message-actions.png` });
  check("at the check-in desk: Check in and a message together", !!seen, seen?.text ?? "never both");
  if (seen) {
    check("…Check in sits wholly above the message", seen.btnBottom <= seen.msgTop, `button ends ${seen.btnBottom}, message starts ${seen.msgTop}`);
    check("…and nothing covers the message", seen.msgOnTop);
  }
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
