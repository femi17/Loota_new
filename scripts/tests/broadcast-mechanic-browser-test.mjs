// The mechanic at work on the broadcast (owner, 19 Nov 2026: "On the broadcast, the mechanic is not working on the
// vehicle. They are just standing"). A hunter in a live test hunt rides a motorbike with a worn engine to a mechanic's
// and has it serviced (a phone, its own browser). The owner's broadcast follows them (a laptop, its own browser): the
// same open workshop, with THEIR motorbike on the stand; when the job starts the mechanic walks over to it and works on
// it, bent over with a spanner, as on their screen; once done, back to the counter. Saved as the scene's vehicle and its
// "pose" lines. The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-mechanic-browser-test.mjs
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
const NL = String.fromCharCode(10);
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const ids = [];
let huntId = null, browser, browser2;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const WORK = { x: -1.9, z: -3.7 }, COUNTER = { x: -2.2, z: -4.6 }; // models3d SHOP_SPOTS: the mechanic at the stand, at the counter
const near = (a, b) => !!a && Math.hypot(a.x - b.x, a.z - b.z) < 0.15;
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bmech-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const { data: shop } = await admin.from("places").select("name, lng, lat").eq("kind", "mechanic").gte("lng", 3.36).lte("lng", 3.40).gte("lat", 6.49).lte("lat", 6.53).limit(1).single();
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Biker${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: shop.lng, home_lat: shop.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", hunter.id);
  await admin.rpc("apply_coin_change", { p_user: hunter.id, p_amount: 200, p_kind: "admin", p_reason: "Broadcast mechanic test" });
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "motorbike", fuel: 80, tyre: 100, engine: 60, lng: shop.lng, lat: shop.lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: shop.lng, lat: shop.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast mechanic test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The test key, far away.", category: "maths", area_lng: 3.45, area_lat: 6.58, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.58 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60), guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });

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
  const text = () => game.evaluate((nl) => document.querySelector('[role="dialog"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const until = async (re, tries = 40) => {
    let t = null;
    for (let i = 0; i < tries && !re.test(t ?? ""); i++) { await wait(500); t = await text(); }
    return t;
  };

  // Into the workshop on their phone
  let tapped = false;
  for (let i = 0; i < 20 && !tapped; i++) {
    tapped = await game.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.includes("Service · 60")); b?.click(); return !!b; });
    if (!tapped) await wait(1000);
  }
  const greet = await until(/about 35 seconds/);
  check(`their phone: at ${shop.name}, the mechanic offers a service`, /about 35 seconds/.test(greet ?? ""), greet?.slice(0, 100));

  const scene = () => show.evaluate(() => window.__broadcastShown?.().scene ?? null);
  let s = null;
  for (let i = 0; i < 40 && !(s?.scale > 1); i++) { await wait(500); s = await scene(); }
  check("the broadcast: the same workshop, built at the kerb", s?.scale > 1, JSON.stringify(s));
  check("…with their motorbike in it, on the stand", !!s?.vehicle?.shown, JSON.stringify(s?.vehicle));
  check("…the mechanic waiting at the counter, standing", near(s?.keeper, COUNTER) && Math.abs(s.keeper.bent) < 0.1, JSON.stringify(s?.keeper));

  // Go ahead: the job starts
  await game.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.startsWith("Go ahead"))?.click());
  let working = null;
  for (let i = 0; i < 40 && !(near(working?.keeper, WORK) && working.keeper.bent > 0.3); i++) { await wait(500); working = await scene(); }
  check("…the job starts: the mechanic walks over to the motorbike and works on it, bent over it", near(working?.keeper, WORK) && working.keeper.bent > 0.3, JSON.stringify(working?.keeper));
  await show.screenshot({ path: `${OUT}/broadcast-mechanic-1-working.png` });
  await game.screenshot({ path: `${OUT}/broadcast-mechanic-1-phone.png` });
  await wait(8000);
  const still = await scene();
  check("…and keeps working while the job runs", near(still?.keeper, WORK) && still.keeper.bent > 0.3, JSON.stringify(still?.keeper));

  const done = await until(/runs like new/, 70);
  check("their phone: the motorbike runs like new", /runs like new/.test(done ?? ""), done?.slice(-80));
  let back = null;
  for (let i = 0; i < 40 && !(near(back?.keeper, COUNTER) && Math.abs(back.keeper.bent) < 0.1); i++) { await wait(500); back = await scene(); }
  check("the broadcast: done, the mechanic back at the counter, standing up", near(back?.keeper, COUNTER) && Math.abs(back.keeper.bent) < 0.1, JSON.stringify(back?.keeper));
  await show.screenshot({ path: `${OUT}/broadcast-mechanic-2-done.png` });

  const { data: saved } = await admin.from("hunter_scenes").select("data, lines").eq("user_id", hunter.id).order("started_ms", { ascending: false }).limit(1).single();
  const poses = (saved?.lines ?? []).filter((l) => l[1] === "pose");
  check("saved: the vehicle, and a few pose lines (not one a frame)", saved?.data?.vehicle?.prop === "motorbike" && poses.length >= 2 && poses.length <= 12, `${saved?.data?.vehicle?.prop}, ${poses.length} poses`);
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
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
