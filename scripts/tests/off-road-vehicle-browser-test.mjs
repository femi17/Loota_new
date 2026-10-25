// Off the road, onto a vehicle (owner, 25 Oct 2026: "I cannot get on any of my vehicle"). The owner had been thrown out
// of a Key Trial to a spot off any road (6.4324, 3.3953, south of TBS); the map put them on the nearest road 380 m off,
// the server refused that as walking too fast, and every save and every vehicle was refused after. From that very spot,
// with a bicycle and a motorbike in the pocket: the map reports the move (place_on_road) and "Take it out" works.
// The hunt and test player are deleted.   SHOTS=<folder> node scripts/tests/off-road-vehicle-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
let id = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const rpcs = [];
const at = { lng: 3.39529116286266, lat: 6.43240409995375 }; // the owner's spot
try {
  const email = `repro-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ coins: 1000, home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { error: vErr } = await admin.from("player_vehicles").insert([
    { user_id: id, kind: "bicycle", fuel: 100, lng: at.lng, lat: at.lat, in_use: false, helmet: false, registered: false },
    { user_id: id, kind: "motorbike", fuel: 80, lng: at.lng, lat: at.lat, in_use: false, helmet: true, registered: true },
  ]);
  if (vErr) throw vErr;
  const { data: hunt } = await admin.from("hunts").insert({ title: "Repro (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true }).select("id").single();
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Repro key.", category: "maths", trial_kind: "sentries", area_lng: 3.3958, area_lat: 6.4541, area_radius_m: 800, spot_lng: 3.3958, spot_lat: 6.4541 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, riddle_n: 1, riddle_at: ago(100), guess_n: 1, guess_name: "TBS", guess_lng: 3.3958, guess_lat: 6.4541 });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text().slice(0, 200)); });
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("/rpc/")) return;
    let body = "";
    try { body = await r.text(); } catch {}
    rpcs.push({ fn: u.split("/rpc/")[1], body });
  });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
  }, huntId, id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  const body = () => page.evaluate(() => document.body.innerText.split("\n").filter(Boolean).join(" | "));
  await page.evaluate(() => document.querySelector('[data-tool="travel"]')?.click());
  await wait(2000);
  const panel = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.split("\n").filter(Boolean).join(" | ") ?? null);
  const buttons = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent?.trim()));
  check("Vehicles: Take it out, for each", buttons.filter((b) => b === "Take it out").length === 2, JSON.stringify(buttons));
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Take it out")?.click());
  await wait(4000);
  const { data: pos } = await admin.from("player_positions").select("mode").eq("user_id", id).single();
  const { data: vs } = await admin.from("player_vehicles").select("kind, in_use").eq("user_id", id);
  const placed = rpcs.find((x) => x.fn === "place_on_road" && /"ok": ?true/.test(x.body));
  check("put on the road: the server told (place_on_road)", !!placed, placed?.body);
  check("no \"walking too fast\" refusals after that", !rpcs.some((x, i) => i > rpcs.indexOf(placed) && x.fn === "save_position" && /"reason": ?"speed"/.test(x.body)));
  check("on the bicycle", pos.mode === "bicycle" && vs.some((v) => v.kind === "bicycle" && v.in_use), `${pos.mode} ${JSON.stringify(vs)}`);
  await page.screenshot({ path: `${OUT}/repro-vehicle.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) {
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
