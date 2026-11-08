// Full screen and sideways on a phone (owner, 8 Nov 2026: "on mobile, when a user clicks on free roam or joins a hunt,
// can we make the hunt/play page a landscape mode in fullscreen. That way gives users more room to see the screen and
// move"). On an Android phone:
//   1. the lobby's "Play free roam" tapped: the map opens full screen;
//   2. the map reloaded (full screen is lost): one offer to play full screen; tapped, full screen again;
//   3. held sideways in a hunt (a story hunt's nine tools): every tool on the screen, none off the bottom;
// and on an iPhone (no full screen for web pages): held upright, a hint to turn the phone, gone once it's turned.
// The test hunt and player are deleted.   SHOTS=<folder> node scripts/tests/fullscreen-browser-test.mjs
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
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
let id = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
async function until(page, fn, ms = 30000) {
  for (let t = 0; t < ms; t += 400) { if (await page.evaluate(fn).catch(() => false)) return true; await wait(400); }
  return false;
}

try {
  const email = `fullscr-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: HOME.lng, lat: HOME.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const phone = async (ua, viewport, noFullscreen = false) => {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.emulate({ viewport: { deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...viewport }, userAgent: ua });
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid, no) => {
      try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
      if (no) delete Element.prototype.requestFullscreen; // an iPhone's Safari: no full screen for pages
    }, id, noFullscreen);
    return page;
  };
  const tapText = async (page, re) => {
    const el = await page.evaluateHandle((src) => [...document.querySelectorAll("a, button")].find((x) => new RegExp(src).test(x.textContent ?? "")) ?? null, re.source);
    const box = await el.asElement()?.boundingBox();
    if (!box) return false;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  };
  const full = (page) => page.evaluate(() => !!document.fullscreenElement);

  // 1. From the lobby
  const android = await phone(ANDROID, { width: 390, height: 844 });
  await android.goto("http://localhost:3000/lobby", { waitUntil: "networkidle2", timeout: 120000 });
  const tapped = await tapText(android, /Play free roam/);
  const onMap = await until(android, () => location.pathname === "/play" && !!document.querySelector("canvas.maplibregl-canvas"), 60000);
  check("Android, the lobby's Play free roam tapped: the map opens full screen", tapped && onMap && (await full(android)), `on the map ${onMap}, full screen ${await full(android)}`);
  await wait(4000);
  check("…and no offer to go full screen (it is already)", !(await android.$("[data-fullscreen-offer]")));

  // 2. Reloaded: the offer
  await android.reload({ waitUntil: "domcontentloaded" });
  const offered = await until(android, () => document.querySelector("[data-fullscreen-offer]")?.getAttribute("data-fullscreen-offer") === "fullscreen", 40000);
  check("reloaded (full screen lost): one offer to play full screen", offered && !(await full(android)));
  await android.screenshot({ path: `${OUT}/fullscreen-offer.png` });
  await tapText(android, /^Full screen$/);
  const again = await until(android, () => !!document.fullscreenElement, 5000);
  check("…tapped: full screen again, and the offer goes", again && !(await android.$("[data-fullscreen-offer]")));
  await android.close();

  // 3. Sideways in a story hunt: every tool on the screen
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Full screen test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "puzzle", area_lng: 3.39, area_lat: 6.50, area_radius_m: 1500, spot_lng: 3.39, spot_lat: 6.50, exact_m: 300 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const sideways = await phone(ANDROID, { width: 844, height: 390, isLandscape: true });
  await sideways.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(sideways, () => !!document.querySelector('[data-tool="leaderboard"]'), 60000);
  await wait(3000);
  const tools = await sideways.evaluate(() => [...document.querySelectorAll('nav[aria-label="Tools"] button')].map((b) => { const r = b.getBoundingClientRect(); return { bottom: r.bottom, right: r.right, label: b.getAttribute("aria-label") }; }));
  const h = await sideways.evaluate(() => window.innerHeight);
  const off = tools.filter((t) => t.bottom > h || t.right > 844);
  check("held sideways in a hunt: every tool on the screen", tools.length >= 7 && tools.every((t) => t.bottom <= h && t.right <= 844), `${tools.length} tools; lowest at ${Math.round(Math.max(...tools.map((t) => t.bottom)))} of ${h}${off.length ? `; off: ${off.map((t) => t.label).join(", ")}` : ""}`);
  for (let i = 0; i < 4; i++) {
    await sideways.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Skip|Not now|^✕$/.test(b.textContent?.trim() ?? ""))?.click());
    await wait(1200);
  }
  await sideways.screenshot({ path: `${OUT}/fullscreen-sideways-hunt.png` });
  await sideways.close();

  // 4. An iPhone held upright: the hint to turn it
  const iphone = await phone(IPHONE, { width: 390, height: 844 }, true);
  await iphone.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const hint = await until(iphone, () => document.querySelector("[data-fullscreen-offer]")?.getAttribute("data-fullscreen-offer") === "turn", 40000);
  check("iPhone held upright: a hint to turn the phone sideways (no full screen there)", hint);
  await iphone.screenshot({ path: `${OUT}/fullscreen-iphone-hint.png` });
  await iphone.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  const gone = await until(iphone, () => !document.querySelector("[data-fullscreen-offer]"), 5000);
  check("…turned sideways: the hint goes", gone);
  await iphone.close();
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
