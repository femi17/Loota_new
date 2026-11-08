// Free roam is the lamp's ground (owner, 8 Nov 2026: "the lamps only shows in the free roam, and it points to stuff
// user can do"): a player in no hunt opens the lamp and sees a Detour nearby at its full reward; the lamp's arrow points
// to it (north of them, about 300 m). Then they join a live hunt: the lamp is gone from the tools. The test Detour, hunt
// and player are deleted.
//   SHOTS=<folder> node scripts/tests/lamp-free-roam-browser-test.mjs
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
let id = null, detourId = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const yaba = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `lamp-free-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  // A Detour 300 m away in the player's area, ending before any other there (the lamp shows the soonest first).
  const { data: area } = await admin.rpc("detour_area", { p_lng: yaba.lng, p_lat: yaba.lat });
  const { data: d, error } = await admin.from("detours")
    .insert({ kind: "flash", area, title: "A test pouch", story: "Something fell off a danfo's roof.", place_name: "Tejuosho Market", lng: yaba.lng, lat: yaba.lat + 300 / 110574, reward_coins: 80, ends_at: new Date(Date.now() + 150e3).toISOString() })
    .select("id").single();
  if (error) throw error;
  detourId = d.id;

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
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  await page.evaluate(() => document.querySelector("[data-tool=lamp]")?.click());
  await wait(3500);
  if (await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="The Djinn"]'))) {
    await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="The Djinn"] button[aria-label="Close"]')?.click());
    await wait(800);
    await page.evaluate(() => document.querySelector("[data-tool=lamp]")?.click());
    await wait(3500);
  }
  const lamp = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
  // Ours, or a real one nearby ending sooner (the lamp shows one thing at a time).
  check("free roam: the lamp shows a Detour", /Flash|Rush/.test(lamp), lamp.slice(0, 160).split("\n").join(" | "));
  const reward = lamp.split("\n").find((l) => / · /.test(l) && /coins|relic/.test(l)) ?? "";
  check("…at its full reward (free roam is the lamp's ground: owner, 8 Nov 2026)", !/half/.test(reward), reward);
  if (/A test pouch/.test(lamp)) check("…ours: all 80 coins", /80 coins/.test(reward), reward);
  await page.screenshot({ path: `${OUT}/lamp-free-roam.png` });
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click());
  await wait(2500);
  const point = await page.evaluate(() => {
    const p = document.querySelector("[data-lamp-point]");
    return p ? { deg: Number(p.getAttribute("data-lamp-point")), text: p.textContent } : null;
  });
  check("the lamp's arrow points the way, with how far", !!point && /\d+(m|\.\dk|k)$/.test(point.text ?? ""), JSON.stringify(point));
  if (/A test pouch/.test(lamp) && point) {
    const bearing = await page.evaluate(() => window.__lootaMap?.getBearing?.() ?? null);
    check("…to ours: about 300 m", /^(2\d\d|3[0-4]\d)m$/.test(point.text), point.text);
    if (bearing !== null) {
      const want = (360 - bearing + 360) % 360, off = Math.min(Math.abs(point.deg - want), 360 - Math.abs(point.deg - want));
      check("…north of us, turned with the map", off < 25, `arrow ${point.deg}°, map bearing ${Math.round(bearing)}°`);
    }
  }
  await page.screenshot({ path: `${OUT}/lamp-arrow.png`, clip: { x: 290, y: 0, width: 100, height: 520 } });

  // Racing in a live hunt: the lamp leaves the tools
  const { data: hunt, error: he } = await admin.from("hunts")
    .insert({ title: "Lamp test (automated)", prize: "none", winners: 1, starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (he) throw he;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "A test key far away.", category: "maths", area_lng: 3.45, area_lat: 6.6, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.6 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  const tools = await page.evaluate(() => ({ lamp: !!document.querySelector("[data-tool=lamp]"), directions: !!document.querySelector("[data-tool=directions]") }));
  check("racing in a hunt: no lamp in the tools (the others still there)", !tools.lamp && tools.directions, JSON.stringify(tools));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (detourId) await admin.from("detours").delete().eq("id", detourId);
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test Detour, hunt and player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
