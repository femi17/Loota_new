// Real weather, and the time of day, in the game and on the broadcast (owner, 9 Nov 2026: "The atmosphere should
// reflect the day time in the broadcast, also. How can we add weather it case it rains and all so we can apply that
// too"; chose real weather, and rain slowing as a Rain Charm does). A hunter in a live test hunt in Tokyo (night there
// as this runs, and nobody plays there: a storm forced on it slows no real player); the owner's broadcast follows them.
//   1. the game opens: it asks for the weather; the server looks it up from MET Norway (the square's real weather, kept);
//   2. a storm (forced on the square, as the server sets it): their game draws it with lightning and says it, −30% for
//      walkers and bikes; on the broadcast the same storm over the picture, and "A storm where … is · 30% slower";
//   3. fog instead: the storm ends (no more slowing), fog drawn on both;
//   4. the broadcast's map is dark: night in Tokyo, as on their screen.
// The square's weather, its effects, the hunt and the accounts are cleared after.
//   SHOTS=<folder> node scripts/tests/weather-browser-test.mjs
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
const PLACE = { lng: 139.7005, lat: 35.6591 }; // Tokyo
const CELL = `${Math.floor(PLACE.lng * 10)}_${Math.floor(PLACE.lat * 10)}`;
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `weather-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
const force = (kind, heavy = false) =>
  admin.rpc("weather_set", { p_lng: PLACE.lng, p_lat: PLACE.lat, p_kind: kind, p_symbol: `test_${kind}`, p_heavy: heavy, p_temp: 18.4, p_expires: new Date(Date.now() + 10 * 60_000).toISOString() });

try {
  // (a square nobody has looked at yet: the game's own look goes to MET Norway)
  await admin.from("weather_cells").delete().eq("cell", CELL);
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Wet${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: PLACE.lng, home_lat: PLACE.lat, home_set_at: new Date().toISOString() }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Weather test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 139.2, area_lat: 35.2, area_radius_m: 500, spot_lng: 139.2, spot_lat: 35.2 });
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
  const until = async (fn, ms = 30000) => { for (let t = 0; t < ms; t += 500) { const v = await fn(); if (v) return v; await wait(500); } return null; };
  const game = await open(browser, await signedIn(hunter), `/play?hunt=${huntId}`, { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, hunter.id);
  const show = await open(browser2, await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 720 });

  // 1. The real weather, looked up
  const kept = await until(async () => (await admin.from("weather_cells").select("kind, symbol, temp, checked_at, expires_at").eq("cell", CELL).maybeSingle()).data, 60000);
  const mins = kept ? Math.round((Date.parse(kept.expires_at) - Date.now()) / 60000) : null;
  check("the game opens: the square's real weather looked up from MET Norway, and kept", !!kept?.symbol && !kept.symbol.startsWith("test_") && mins >= 10 && mins <= 60, kept && `${kept.symbol} → ${kept.kind}, ${kept.temp}°C, looked at again in ${mins} min`);
  const chip = () => game.evaluate((nl) => [...document.querySelectorAll('[aria-label^="Weather"], [aria-label="Rain"], [aria-label="Storm"]')].map((e) => e.innerText.split(nl).join(" ")).join(" | "), NL);
  const shown = await until(async () => { const c = await chip(); return c && c; });
  check("…shown on their screen with the temperature", !!shown && /°/.test(shown), shown);

  // 2. A storm
  await force("storm", true);
  await game.evaluate(() => window.__lootaWeather?.());
  const stormChip = await until(async () => { const c = await chip(); return /−30%/.test(c) && c; }, 40000);
  check("a storm: their screen says walkers and bikes are 30% slower", !!stormChip, stormChip ?? (await chip()));
  const said = await game.evaluate(() => document.body.innerText);
  check("…and tells them so", /A storm here\. Walkers and bikes are 30% slower/.test(said), said.match(/[^\n]*storm[^\n]*/i)?.[0]);
  check("…drawn with lightning", await game.evaluate(() => !!document.querySelector(".loota-rain.loota-storm")));
  await game.screenshot({ path: `${OUT}/weather-1-game-storm.png` });
  await until(() => show.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n)); b?.click(); return !!b; }, name), 30000);
  const bChip = () => show.evaluate(() => document.querySelector('[aria-label="Weather"]')?.textContent ?? null);
  const bStorm = await until(async () => { const c = await bChip(); return /storm/i.test(c ?? "") && c; }, 30000);
  check("on the broadcast: the storm where they are, and that it slows them", /A storm where .* is · 18°C/.test(bStorm ?? "") && /30% slower on foot or bike/.test(bStorm ?? ""), bStorm);
  check("…drawn over the picture", await show.evaluate(() => !!document.querySelector(".loota-rain.loota-storm")));

  // 4. Night in Tokyo: the broadcast's map darkened, as their screen's
  await wait(1500);
  const sky = await show.evaluate(() => ({ night: window.__broadcastShown?.().night, dark: window.__broadcastMap?.getPaintProperty("b-night-ground", "fill-opacity") }));
  const local = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  const isNight = local >= 19 || local < 5;
  check(`the broadcast's map: ${isNight ? "night" : "day"} in Tokyo (${local}:00 there), as on their screen`, isNight ? sky.dark > 0.4 && sky.night === true : sky.dark < 0.3, JSON.stringify(sky));
  await show.screenshot({ path: `${OUT}/weather-2-broadcast-storm.png` });

  // 3. Fog instead: the storm ends
  await force("fog");
  await game.evaluate(() => window.__lootaWeather?.());
  const fog = await until(async () => { const c = await chip(); return /🌫/.test(c) && !/−30%/.test(c) && c; }, 40000);
  check("fog instead: the storm and its slowing end, fog shown", !!fog, fog ?? (await chip()));
  check("…drawn on their screen", await game.evaluate(() => !!document.querySelector(".loota-fog") && !document.querySelector(".loota-storm")));
  const bFog = await until(async () => { const c = await bChip(); return /Fog/.test(c ?? "") && c; }, 30000);
  check("…and on the broadcast (no slowing)", !!bFog && !/slower/.test(bFog) && (await show.evaluate(() => !!document.querySelector(".loota-fog"))), bFog);
  await show.screenshot({ path: `${OUT}/weather-3-broadcast-fog.png` });
  const { data: effects } = await admin.from("world_effects").select("weather, ends_at").not("weather", "is", null).gte("lng", 139.7).lte("lng", 139.8).gte("lat", 35.6).lte("lat", 35.7);
  const active = (effects ?? []).filter((e) => Date.parse(e.ends_at) > Date.now());
  check("…on the server: the storm's effect ended, none started for fog", (effects ?? []).some((e) => e.weather === "storm") && active.length === 0, JSON.stringify(effects));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  // The square's forced weather and its effects gone (real players there get the real weather next time)
  await admin.from("world_effects").update({ ends_at: new Date().toISOString() }).not("weather", "is", null).gte("lng", 139.7).lte("lng", 139.8).gte("lat", 35.6).lte("lat", 35.7).gt("ends_at", new Date().toISOString());
  await admin.from("weather_cells").delete().eq("cell", CELL);
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log(`(couldn't delete test account ${id}: ${error.message})`);
  }
  console.log(`the square's weather, the hunt and the test accounts cleared; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
