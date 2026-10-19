// Out of fuel, the whole way (phone, owner 19 Oct 2026): riding a motorbike in Yaba until the tank runs dry, it stays
// at the roadside; the advice sends you to the NEAREST petrol station with a road route (never a straight line); at the
// station the attendant sells and fills a jerry can (65% of a tank); the way back to the motorbike is drawn; beside it
// "Pour can" puts 65% in the tank and you ride on. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/jerry-can-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 }; // on a road in Yaba

try {
  const email = `jerry-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Jerry can test" });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 0.3, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  // No road events in this test (one "just happened").
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const shot = (name) => page.screenshot({ path: `${OUT}/jerry-${name}.png` });
  const body = () => page.evaluate((nl) => document.body.innerText.split(nl).join(" | "), NL);
  const bike = async () => (await admin.from("player_vehicles").select("fuel, in_use, stranded_at, lng, lat").eq("user_id", id).single()).data;
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const open = async () => {
    await page.goto("about:blank");
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };
  const tapHere = (x) => page.evaluate((s) => {
    const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.trim().includes(s) && !e.disabled);
    b?.click();
    return !!b;
  }, x);
  const clickWhenThere = async (x) => {
    for (let i = 0; i < 24; i++) {
      if (await page.evaluate((s) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((e) => e.textContent?.trim().startsWith(s)); b?.click(); return !!b; }, x)) return true;
      await wait(500);
    }
    return false;
  };
  /** The drawn route: how many points, how long, its longest straight piece. */
  const route = () => page.evaluate(() => {
    const d = window.__lootaMap.getSource("route").serialize().data;
    const coords = d?.geometry?.coordinates ?? [];
    const m = (a, b) => Math.hypot((a[0] - b[0]) * 110400, (a[1] - b[1]) * 110574);
    let total = 0, longest = 0;
    for (let i = 1; i < coords.length; i++) { const x = m(coords[i - 1], coords[i]); total += x; longest = Math.max(longest, x); }
    return { points: coords.length, total: Math.round(total), longest: Math.round(longest), end: coords.at(-1) ?? null };
  });
  const waitRoute = async () => {
    let r = await route();
    for (let i = 0; i < 30 && r.points < 2; i++) { await wait(1000); r = await route(); }
    return r;
  };

  // ---- Riding until the tank runs dry
  await open();
  await page.keyboard.down("ArrowUp");
  let b = await bike();
  for (let i = 0; i < 40 && !b.stranded_at; i++) { await wait(1000); b = await bike(); }
  await page.keyboard.up("ArrowUp");
  check("ridden dry: the motorbike stays at the roadside", !!b.stranded_at && !b.in_use, JSON.stringify(b));
  await wait(6000);
  const said = await body();
  check("…told so, and sent to the nearest petrol station", /Out of fuel! Your motorbike is parked at the roadside/.test(said) && /The nearest: /.test(said), said.match(/Out of fuel[^|]*/)?.[0]);
  const way = await waitRoute();
  check("…by road, not a straight line", way.points > 2 && way.longest < 400, JSON.stringify(way));
  await shot("1-dry");
  // The station it chose: where the route ends.
  const { data: stations } = await admin.from("places").select("id, name, lng, lat").eq("kind", "fuel")
    .gte("lng", b.lng - 0.05).lte("lng", b.lng + 0.05).gte("lat", b.lat - 0.05).lte("lat", b.lat + 0.05);
  const dist = (p) => Math.hypot((p.lng - b.lng) * 110400, (p.lat - b.lat) * 110574);
  const nearest = stations.sort((x, y) => dist(x) - dist(y))[0];
  const toEnd = Math.hypot((way.end[0] - nearest.lng) * 110400, (way.end[1] - nearest.lat) * 110574);
  check(`…the nearest one (${nearest.name}, ${Math.round(dist(nearest))} m)`, toEnd < 120, `route ends ${Math.round(toEnd)} m from it`);
  // The game reopened: the way to the station is drawn again by itself.
  await open();
  const again = await waitRoute();
  const againEnd = again.end ? Math.hypot((again.end[0] - nearest.lng) * 110400, (again.end[1] - nearest.lat) * 110574) : Infinity;
  check("reopening the game: the way to the station again, by itself", again.points > 2 && againEnd < 120, `${JSON.stringify(again)} · ${Math.round(againEnd)} m`);

  // ---- At the petrol station: a jerry can, filled
  await admin.from("player_positions").update({ lng: nearest.lng, lat: nearest.lat, mode: "walk", updated_at: ago(30) }).eq("user_id", id);
  await open();
  check("at the station: a Jerry can button", await tapHere("Jerry can"));
  let scene = null; // (the attendant's line types itself out)
  for (let i = 0; i < 30 && !/to the top/.test(scene ?? ""); i++) {
    await wait(500);
    scene = await page.evaluate((nl) => document.querySelector('[role="dialog"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  }
  check("…the attendant: your okada ran dry? a jerry can to carry back, to 65%", /ran dry on the road/.test(scene ?? "") && /65%/.test(scene ?? ""), scene);
  const c0 = await coins();
  check("…buy and fill it", await clickWhenThere("Jerry can and fuel · 155"));
  let filled = null;
  for (let i = 0; i < 20 && !/in your can/.test(filled ?? ""); i++) { await wait(500); filled = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? ""); }
  const { data: keg } = await admin.from("player_kegs").select("fuel").eq("user_id", id).single();
  check("…65% of a tank in the can, 155 coins", keg.fuel === 65 && (await coins()) === c0 - 155, `${keg.fuel} · ${c0 - (await coins())}`);
  await shot("2-can");
  const atPump = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? "");
  check("…the attendant fills the can (your okada isn't at the pump)", /in your can/.test(atPump));
  await clickWhenThere("Thanks! I'll carry it back");
  await wait(6000);
  const back = await body();
  check("leaving: the way back to the motorbike", /Carry the jerry can back to your motorbike/.test(back), back.match(/Carry[^|]*/)?.[0]);
  const wayBack = await waitRoute();
  const toBike = Math.hypot((wayBack.end[0] - b.lng) * 110400, (wayBack.end[1] - b.lat) * 110574);
  check("…by road, to where it stands", wayBack.points > 2 && wayBack.longest < 400 && toBike < 60, `${JSON.stringify(wayBack)} · ${Math.round(toBike)} m`);
  await wait(3000);
  await shot("3-carry");
  // The game reopened with fuel in the can: the way back is drawn again by itself.
  await open();
  const back2 = await waitRoute();
  const back2End = back2.end ? Math.hypot((back2.end[0] - b.lng) * 110400, (back2.end[1] - b.lat) * 110574) : Infinity;
  check("reopening the game with the can full: the way back again, by itself", back2.points > 2 && back2End < 60, `${JSON.stringify(back2)} · ${Math.round(back2End)} m`);

  // ---- Beside the motorbike: pour it in, ride on
  await admin.from("player_positions").update({ lng: b.lng, lat: b.lat, mode: "walk", updated_at: ago(30) }).eq("user_id", id);
  await open();
  await shot("4-beside");
  check("beside it: Pour can", await tapHere("Pour can"));
  await wait(4000);
  const after = await bike();
  const poured = await body();
  check("…the tank at 65%, and back on it", Math.round(after.fuel) === 65 && after.in_use && !after.stranded_at && /you're back on it/.test(poured), JSON.stringify(after));
  // Ride on: the furthest it gets from where it stood (at the end of a road it turns, so where it ends up can be close).
  let m = 0;
  await page.keyboard.down("ArrowUp");
  for (let i = 0; i < 10; i++) {
    await wait(400);
    const c = await page.evaluate(() => { const x = window.__lootaMap.getCenter(); return [x.lng, x.lat]; });
    m = Math.max(m, Math.hypot((c[0] - b.lng) * 110400, (c[1] - b.lat) * 110574));
  }
  await page.keyboard.up("ArrowUp");
  await wait(5000);
  const moved = await bike();
  check("…and it rides", m > 50 && moved.fuel < 65, `${Math.round(m)} m at the furthest`);
  await shot("5-ride");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
