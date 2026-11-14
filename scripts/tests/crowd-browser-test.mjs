// A crowd (owner, 14 Nov 2026: "in order not to over crowd the screen, we can add like 10 player on the screen at once,
// then if they pass 10 indicate the count"). A player in free roam with 16 other hunters around (five on the very spot
// they stand on), heard on the live channel:
//   1. only the ten nearest are drawn; the chip says "10 +6";
//   2. those on the same spot stand a step aside (in a ring), not on top of each other or the player;
//   3. three of the far ones come close: they're drawn now, in place of the furthest.
// The accounts are deleted.   SHOTS=<folder> node scripts/tests/crowd-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const ids = [];
let browser, sender;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const until = async (fn, ms = 20000, step = 300) => { for (let t = 0; t < ms; t += step) { const v = await fn(); if (v) return v; await wait(step); } return null; };
const HOME = { lng: 3.3787, lat: 6.5186 };
const AREA = `${Math.floor(HOME.lng / 0.02)}_${Math.floor(HOME.lat / 0.02)}`;
const east = (m) => m / (111320 * Math.cos((HOME.lat * Math.PI) / 180));
const user = async (tag) => {
  const email = `crowd-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};

try {
  const me = await user("player");
  await admin.from("profiles").update({ username: `Watcher${Date.now() % 1000}`, home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString(), coins: 100 }).eq("id", me.id);
  await admin.from("player_positions").upsert({ user_id: me.id, lng: HOME.lng, lat: HOME.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  // 16 around: five on the player's own spot, the rest 30 m to 330 m east
  const crowd = [];
  for (let i = 0; i < 16; i++) {
    const u = await user(`c${i}`);
    const at = i < 5 ? { ...HOME } : { lng: HOME.lng + east(30 + (i - 5) * 30), lat: HOME.lat };
    await admin.from("profiles").update({ username: `Crowd${String(i).padStart(2, "0")}`, home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString() }).eq("id", u.id);
    await admin.from("player_positions").upsert({ user_id: u.id, lng: at.lng, lat: at.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
    crowd.push({ ...u, at, name: `Crowd${String(i).padStart(2, "0")}` });
  }

  // The player's game
  const jar = new Map();
  const sc = createServerClient(url, PUBLIC_KEY, { cookies: { getAll: () => [...jar].map(([n, value]) => ({ name: n, value })), setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await sc.auth.signInWithPassword({ email: me.email, password: me.password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const game = await (await browser.createBrowserContext()).newPage();
  await game.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  game.on("pageerror", (e) => problems.push(e.message));
  await game.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await game.evaluateOnNewDocument((id) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); } catch {} }, me.id);
  await game.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(() => game.evaluate(() => !!window.__lootaMap && !!window.__lootaCrowd).catch(() => false), 120000, 1000);
  await wait(6000);

  // The crowd, heard on the live channel (one signed-in hunter sends for all of them: the game checks each with the server)
  sender = createClient(url, PUBLIC_KEY, { auth: { persistSession: false } });
  await sender.auth.signInWithPassword({ email: crowd[0].email, password: crowd[0].password });
  await sender.realtime.setAuth();
  const ch = sender.channel(`hunters:${AREA}`, { config: { private: true, broadcast: { self: false } } });
  await new Promise((r) => { const t = setTimeout(r, 8000); ch.subscribe((st) => { if (st === "SUBSCRIBED") { clearTimeout(t); r(); } }); });
  let talking = true;
  const talk = (async () => {
    while (talking) {
      for (const c of crowd) await ch.send({ type: "broadcast", event: "pos", payload: { id: c.id, name: c.name, look: {}, lng: c.at.lng, lat: c.at.lat, heading: 0, mode: "walk", moving: false } });
      await wait(1000);
    }
  })();

  // 1. Ten drawn, the count of the rest
  const crowded = await until(() => game.evaluate(() => { const c = window.__lootaCrowd(); return c.heard >= 16 && c.shown === 10 ? c : null; }), 40000, 500);
  const shown = await game.evaluate(() => window.__lootaOthers());
  const nearest = crowd.slice(0, 10).map((c) => c.id);
  check("1. sixteen hunters around: the ten nearest drawn", !!crowded && shown.length === 10 && shown.every((id) => nearest.includes(id)), JSON.stringify(crowded));
  const chip = await game.evaluate(() => { const el = document.querySelector("[data-hunters]"); return el ? { all: el.getAttribute("data-hunters"), shown: el.getAttribute("data-hunters-shown"), text: el.textContent } : null; });
  const more = Number(chip?.all) - 10; // (6, or more if a real hunter is about too)
  check(`…the chip: "10 +${more}"`, Number(chip?.all) >= 16 && chip?.shown === "10" && (chip?.text ?? "").replace(/\s/g, "") === `10+${more}`, JSON.stringify(chip));
  // 2. A step aside
  check("2. five on one spot (by the player): one stands on it, the others a step aside in a ring", (crowded?.aside ?? 0) >= 4, `${crowded?.aside} aside`);
  await game.screenshot({ path: `${OUT}/crowd-1.png` });
  // 3. Three far ones come close
  for (const c of crowd.slice(13)) {
    c.at = { lng: HOME.lng + east(10), lat: HOME.lat + 0.00005 };
    await admin.from("player_positions").update({ lng: c.at.lng, lat: c.at.lat, updated_at: new Date().toISOString() }).eq("user_id", c.id);
  }
  const swapped = await until(async () => { const s = await game.evaluate(() => window.__lootaOthers()); return crowd.slice(13).every((c) => s.includes(c.id)) && s.length === 10 ? s : null; }, 40000, 500);
  check("3. three far ones come close: drawn now, in place of the furthest", !!swapped && !swapped.includes(crowd[9].id), swapped ? `${swapped.length} drawn` : "");
  await game.screenshot({ path: `${OUT}/crowd-2.png` });
  talking = false;
  await talk;
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (sender) await sender.removeAllChannels();
  for (const id of ids) {
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
