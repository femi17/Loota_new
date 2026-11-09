// Why they slow down, on the broadcast (owner, 9 Nov 2026: "add the traffic light, the traffic, so viewers can know the
// reason the slows down is because of the traffic or traffic light"). A hunter in a live test hunt rides their motorbike
// across town by themselves (a phone, its own browser) until a red light stops them on their own screen; the owner's
// broadcast follows them (a laptop, its own browser): the real traffic lights stand around them in 3D, and a few seconds
// later (its delay) "🚦 Red light" comes up on the screen; the jammed stretches are drawn when there are any at this hour.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-traffic-browser-test.mjs
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
const ids = [];
let huntId = null, browser, browser2;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 }; // Yaba
const target = { lng: 3.3560, lat: 6.5800 }; // 7 km on, through junctions with lights
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `btraffic-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};
const signedIn = async (u) => {
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: u.email, password: u.password });
  return jar;
};

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Rider${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "motorbike", lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast traffic test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The test key, far away.", category: "maths", area_lng: 3.45, area_lat: 6.58, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.58 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60), guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });
  // No road events in this test (one "just happened")
  await admin.from("road_events").insert({ user_id: hunter.id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

  browser = await launch();
  browser2 = await launch();
  const problems = [];
  const open = async (b, jar, path, viewport, uid) => {
    const page = await (await b.createBrowserContext()).newPage();
    await page.setViewport(viewport);
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    if (uid) await page.evaluateOnNewDocument((id, h) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); localStorage.setItem(`loota:riddle-seen:${h}`, "1"); } catch {} }, uid, huntId);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    return page;
  };
  const game = await open(browser, await signedIn(hunter), `/play?hunt=${huntId}`, { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, hunter.id);
  const show = await open(browser2, await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 720 });
  await wait(20000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  await game.evaluate((t) => {
    const m = window.__lootaMap;
    m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
  }, target);

  // Riding until a red light stops them on their own screen (and watching the broadcast all along)
  let redAt = null, seenRed = false, lightsShown = 0, jamsDrawn = 0, slowSeen = 0;
  for (let i = 0; i < 240 && !(redAt && seenRed); i++) {
    await wait(500);
    if (!redAt && (await game.evaluate(() => !!document.querySelector('[aria-label^="Red light"]')))) redAt = Date.now();
    const b = await show.evaluate(() => {
      const all = window.__broadcastShown?.();
      const chip = document.querySelector('[aria-label="Why they\'re slow"]')?.textContent ?? "";
      const jams = window.__broadcastMap?.getSource("b-traffic")?.serialize?.().data?.features?.length ?? 0;
      return { why: all?.slowWhy ?? 0, lights: all?.lights ?? 0, chip, jams };
    });
    lightsShown = Math.max(lightsShown, b.lights);
    jamsDrawn = Math.max(jamsDrawn, b.jams);
    if (b.why >= 2) slowSeen = b.why;
    if (redAt && b.why === 1 && /Red light/.test(b.chip)) {
      seenRed = true;
      console.log(`   the broadcast said "${b.chip.trim()}" ${((Date.now() - redAt) / 1000).toFixed(1)} s after their own screen did`);
      await show.screenshot({ path: `${OUT}/broadcast-red-light.png` });
    }
  }
  check("riding by themselves: a red light stops them (their own screen)", !!redAt);
  check("on the broadcast: the real traffic lights stand around them", lightsShown > 0, `${lightsShown} lights`);
  check("…and \"🚦 Red light\" comes up when they wait at it (a few seconds behind)", seenRed);
  console.log(`   (jammed stretches drawn: ${jamsDrawn}; slowed by traffic on the broadcast: ${slowSeen ? (slowSeen === 3 ? "a go-slow" : "slow traffic") : "not at this hour"})`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
