// Status cards fold to icons on a phone (owner, 28 Oct 2026: "we cannot keep too many toast on the screen on mobile…
// calling a taxi, we can just show taxi icon and the time badge"). A taxi is on its way: on a phone the 🚕 icon shows
// with the time it arrives in, the card folds away after a moment, opens when the icon is tapped and folds when
// tapped again; on a laptop the card stays open and there are no icons. The taxi is cancelled and the test player deleted.
//   SHOTS=<folder> node scripts/tests/status-pills-browser-test.mjs
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
const at = { lng: 3.3795, lat: 6.5065 }; // Yaba
let browser, id = null, user = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const email = `pills-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Status pills test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  const jar = new Map();
  user = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await user.auth.signInWithPassword({ email, password });
  // A taxi 1.5 km off, to a place 2 km away
  const { data: pick, error } = await user.rpc("request_pickup", {
    p_kind: "taxi", p_lng: at.lng, p_lat: at.lat, p_name: "Herbert Macaulay Way",
    p_driver_path: [[at.lng + 0.014, at.lat], [at.lng, at.lat]], p_trip_path: [[at.lng, at.lat], [at.lng + 0.013, at.lat + 0.013]],
    p_to_name: "Ikoyi", p_to_lng: at.lng + 0.013, p_to_lat: at.lat + 0.013,
  });
  check("a taxi is called", pick?.ok, JSON.stringify(pick ?? error));

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const pill = () => page.evaluate(() => {
    const b = document.querySelector('[data-pill="pickup"]');
    return b ? { text: b.textContent?.trim() ?? "", open: b.getAttribute("aria-expanded") === "true" } : null;
  });
  const card = () => page.evaluate(() => !!document.querySelector('[aria-label="Your pickup"]'));
  let p = null;
  for (let i = 0; i < 60 && !p; i++) {
    await wait(500);
    p = await pill();
  }
  check("phone: the taxi shows as an icon with the time it arrives in", !!p && /🚕/.test(p.text) && /\d+:\d\d|\d+s/.test(p.text), p?.text);
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
  await wait(5000);
  check("…the card folds away after a moment", !(await card()));
  await page.screenshot({ path: `${OUT}/pills-1-folded.png` });
  await page.tap('[data-pill="pickup"]');
  await wait(600);
  check("…tapping the icon opens the card (title, Cancel)", await page.evaluate(() => {
    const c = document.querySelector('[aria-label="Your pickup"]');
    return !!c && /Taxi to Ikoyi/.test(c.textContent ?? "") && /Cancel/.test(c.textContent ?? "");
  }));
  await page.screenshot({ path: `${OUT}/pills-2-open.png` });
  await wait(5000);
  check("…and it stays open while you look", await card());
  await page.tap('[data-pill="pickup"]');
  await wait(600);
  check("…tapping again folds it", !(await card()));
  check("no page errors (phone)", problems.length === 0, problems.join(" / "));

  // A laptop: the card as before, no icons
  await page.setViewport({ width: 1440, height: 900 });
  for (let i = 0; i < 10 && !((await card()) && !(await pill())); i++) await wait(500);
  const wide = await page.evaluate(() => ({ phone: matchMedia("(max-width: 600px)").matches, width: innerWidth }));
  check("laptop: the card stays open, no icons", (await card()) && !(await pill()), `card ${await card()}, icon ${!!(await pill())}, ${JSON.stringify(wide)}`);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (user) await user.rpc("cancel_pickup");
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
