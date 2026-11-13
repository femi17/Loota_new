// A real police chase (owner, 13 Nov 2026: "Make the police give a real chase but how does user escape"; chose a wanted
// level, GTA-style, escape by hiding out of sight, the fine growing with the run, shown big on the broadcast). A hunter in a
// live test hunt on their motorbike, followed on the owner's broadcast:
//   1. they ride on through a checkpoint: the chase (★), a patrol car behind them that closes in on the game's clock;
//      they stop: caught, 50 coins and a minute's wait; on the broadcast the police car, then "caught";
//   2. another checkpoint, ridden through; a minute in the police's sight (the test hurries it): ★★★, a second car from
//      ahead and a roadblock on the road ahead, on their screen and the broadcast;
//   3. out of the police's sight (the test blinds them), at a buka: "Hide" → hiding; their search runs out: lost them, no
//      fine; on the broadcast "hiding", then "lost the police".
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/police-chase-browser-test.mjs
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
const until = async (fn, ms = 20000, step = 300) => { for (let t = 0; t < ms; t += step) { const v = await fn(); if (v) return v; await wait(step); } return null; };
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const start = { lng: 3.3787, lat: 6.5186 };
const targets = [{ lng: 3.3560, lat: 6.5800 }, { lng: 3.4100, lat: 6.6000 }, { lng: 3.3300, lat: 6.4900 }];
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `pchase-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const name = `Runner${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true, coins: 1000 }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "motorbike", lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Police chase test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
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
  await until(() => game.evaluate(() => !!window.__lootaMap).catch(() => false), 120000, 1000);
  await wait(8000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  const clickText = (t) => game.evaluate((x) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((y) => y.textContent?.includes(x) && !y.disabled); b?.click(); return !!b; }, t);
  const chaseNow = () => game.evaluate(() => window.__lootaChase?.() ?? null).catch(() => null);
  let leg = 0;
  /** Riding somewhere, a checkpoint; they ride on through it: the chase. */
  async function rideThrough() {
    const to = targets[leg++ % targets.length];
    await game.evaluate((t) => { const m = window.__lootaMap; m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } }); }, to);
    await wait(3000);
    await admin.from("road_events").insert({ user_id: hunter.id, hunt_id: huntId, kind: "checkpoint", npc: "Officer Bello", question: { prompt: "What does a red traffic light mean?", choices: ["Go faster", "Stop", "Turn left only"], answer: 1 } });
    const rode = await until(() => clickText("Ride on"), 120000, 1000);
    if (!rode) throw new Error("the checkpoint never stopped them");
    return until(() => chaseNow().then((c) => (c?.cops?.length ? c : null)), 30000);
  }

  // 1. The chase; they stop: caught
  const c1 = await rideThrough();
  check("1. rode on through a checkpoint: the chase (★), a patrol car behind them", !!c1 && c1.level === 1 && c1.cops[0]?.kind === "patrol", JSON.stringify(c1));
  const card1 = await until(() => game.evaluate(() => document.querySelector("[data-chase]")?.textContent ?? null), 10000);
  check("…on their screen: the stars and the police", /★/.test(card1 ?? "") && /Police|sight/.test(card1 ?? ""), card1);
  const onShow = await until(() => show.evaluate(() => window.__broadcastShown?.() ? document.querySelector("[data-chase-shown]")?.textContent ?? null : null), 30000);
  check("…on the broadcast: the police after them", /police are after/i.test(onShow ?? ""), onShow);
  await game.evaluate(() => document.querySelector('button[data-drive="on"]')?.click()); // they stop
  const me = await game.evaluate(() => window.__lootaPos?.());
  const gap0 = Math.min(...(await chaseNow()).cops.map((c) => metres(c, me)));
  const caught = await until(async () => /Caught/.test(await game.evaluate(() => document.body.innerText)), 40000, 500);
  const ev1 = (await admin.from("police_chases").select("outcome, level, track").eq("user_id", hunter.id).order("started_at", { ascending: false }).limit(1).single()).data;
  const coins1 = (await admin.from("profiles").select("coins").eq("id", hunter.id).single()).data.coins;
  check("…they stop: the police close in (on the game's clock) and catch them: 50 coins", !!caught && ev1?.outcome === "caught" && Number(coins1) === 950, `${Math.round(gap0)} m behind when they stopped; ${ev1?.outcome}, ${coins1} coins, ${ev1?.track?.length} track points`);
  const caughtShown = await until(() => show.evaluate(() => document.querySelector("[data-chase-shown]")?.getAttribute("data-chase-shown") ?? null).then((s) => (s === "caught" ? s : null)), 20000);
  check("…on the broadcast: caught", caughtShown === "caught");
  await show.screenshot({ path: `${OUT}/police-chase-1-caught.png` });
  await wait(66000); // (held a minute)

  // 2. Another, a minute in their sight: ★★★
  const c2 = await rideThrough();
  check("2. another checkpoint ridden through: a new chase", !!c2 && c2.event !== c1?.event, JSON.stringify(c2));
  await wait(2000);
  await game.evaluate(() => window.__lootaChaseTest?.({ seenS: 61 }));
  const three = await until(() => chaseNow().then((c) => (c?.level === 3 && c.cops.length === 2 && c.roadblock ? c : null)), 15000);
  check("…a minute in their sight: ★★★, a second car from ahead, a roadblock on the road ahead", !!three, JSON.stringify(await chaseNow()));
  // (out of their sight at once, now the test has seen the stars: or the second car and the roadblock catch them)
  await game.evaluate(() => window.__lootaChaseTest?.({ blind: true }));
  await game.evaluate(() => document.querySelector('button[data-drive="on"]')?.click());
  const threeShown = await until(() => show.evaluate(() => ({ stars: document.querySelector("[data-chase-shown]")?.getAttribute("data-chase-stars"), shown: window.__broadcastShown?.() })).then((x) => (x.stars === "3" ? x : null)), 30000);
  check("…on the broadcast: ★★★", !!threeShown);
  await show.screenshot({ path: `${OUT}/police-chase-2-stars.png` });

  // 3. Out of their sight, at a buka: hide; their search runs out
  const here = await game.evaluate(() => window.__lootaPos?.());
  const { data: near } = await admin.rpc("places_near", { p_kinds: ["eat", "rest"], p_lng: here.lng, p_lat: here.lat, p_limit: 1 });
  const spot = near?.[0];
  await game.evaluate((p) => window.__lootaJump?.(p.lng, p.lat), spot);
  const hideBtn = await until(() => game.evaluate(() => !!document.querySelector("[data-chase-hide]")), 20000);
  check("3. out of their sight at a buka: \"Hide\" offered", !!hideBtn, spot?.name);
  await game.evaluate(() => document.querySelector("[data-chase-hide]")?.click());
  const hiding = await until(() => chaseNow().then((c) => c?.hiding ?? null), 10000);
  check("…hiding in it", !!hiding, hiding);
  const hidingShown = await until(() => show.evaluate(() => document.querySelector("[data-chase-shown]")?.getAttribute("data-chase-shown") ?? null).then((s) => (s === "hiding" ? s : null)), 30000);
  check("…on the broadcast: hiding", hidingShown === "hiding");
  await show.screenshot({ path: `${OUT}/police-chase-3-hiding.png` });
  const lost = await until(async () => /You lost them/.test(await game.evaluate(() => document.body.innerText)), 60000, 500);
  const ev2 = (await admin.from("police_chases").select("outcome, level").eq("user_id", hunter.id).order("started_at", { ascending: false }).limit(1).single()).data;
  const coins2 = (await admin.from("profiles").select("coins").eq("id", hunter.id).single()).data.coins;
  check("…their search runs out: lost them, no fine", !!lost && ev2?.outcome === "escaped" && Number(coins2) === Number(coins1), `${ev2?.outcome} (${ev2?.level}★), ${coins2} coins`);
  const searched = await game.evaluate(() => window.__lootaChaseLast ?? null);
  const lostShown = await until(() => show.evaluate(() => document.querySelector("[data-chase-shown]")?.getAttribute("data-chase-shown") ?? null).then((s) => (s === "escaped" ? s : null)), 20000);
  check("…on the broadcast: lost the police", lostShown === "escaped");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  if (huntId) {
    await admin.from("road_events").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("police_chases").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
