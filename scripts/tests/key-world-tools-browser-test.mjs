// The key's world: its tools, the other hunters, and the time of day (owner, 3 Nov 2026: "for user who has digging
// tool, they should be able to use it here like touch light, metal detector, digger, maybe show all the inventory and
// coin, user should be able to buy thing… they should be able to reference the scroll, see the number users who are
// around, let limit it to 10… how do we handle users who are around and they saw a user dig a place and got the
// treasure"; "1 min digging"; "the day time we got there should be the time that is in the key world"). Two hunters at
// key 1 of a story set on a salt flat, the key buried at the water tank:
//   1. Ama opens the world: her coins, 👥 0, the light as the sun is at the place now;
//   2. her bag: the tools; she buys a torch (60 coins);
//   3. Kofi joins: Ama sees 👥 1 and him walking; Kofi's places stand on lots of his own (copying leads elsewhere);
//      Kofi goes into a place: out of Ama's sight;
//   4. Ama digs at the water tank by hand: a minute on the spot (the server won't dig it sooner); she stops, buys a
//      spade (80) and digs again: at once, the key's chest.
// The hunt and the test players are deleted.   SHOTS=<folder> node scripts/tests/key-world-tools-browser-test.mjs
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
let huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const PLACE = { lng: 3.3958, lat: 6.4541 }; // a street in Lagos (the salt flat is the story's scene)
const HOUSE = { title: "The engine yard", style: "manor", items: {}, scene: { ground: "salt", pieces: ["rusty-engines", "water-tower", "tracks"] }, rooms: [
  { id: "tank", name: "The water tank", kind: "cellar", role: "right", outdoor: true },
  { id: "boilers", name: "The boiler house", kind: "storeroom", role: "trap" },
  { id: "shrine", name: "The drivers' shrine", kind: "chapel", role: "safe" },
  { id: "llamas", name: "The llama garden", kind: "study", role: "safe", outdoor: true },
  { id: "salt", name: "The salt stall", kind: "kitchen", role: "safe" },
] };
const SCENE = '[aria-label="The key\'s place"]';

/** A hunter at the place, signed in, in a browser context of their own. */
async function hunter(name) {
  const email = `tools-${name}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500 }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "The place", guess_lng: PLACE.lng, guess_lat: PLACE.lat, leg_lng: PLACE.lng, leg_lat: PLACE.lat });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
  }, huntId, id);
  return { id, c, page, problems };
}
const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
const attr = (page, name) => page.evaluate((sel, n) => document.querySelector(sel)?.getAttribute(n), SCENE, name);
/** A data attribute anywhere in the world's screen. */
const data = (page, name) => page.evaluate((sel, n) => document.querySelector(`${sel} [${n}]`)?.getAttribute(n) ?? null, SCENE, name);
const say = (page) => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "");
const press = (page, re) => page.evaluate((src, sel) => { const b = [...(document.querySelector(sel) ?? document).querySelectorAll("button")].find((x) => new RegExp(src).test(x.textContent ?? "")); b?.click(); return !!b; }, re, SCENE);
const tap = async (page, detail) => {
  await until(async () => (await attr(page, "data-busy")) === "false", 20000);
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
  await wait(300);
};
const explore = async (page) => {
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const go = await until(() => press(page, "Explore the place"), 60000);
  const open = go && (await until(() => page.evaluate((sel) => !!document.querySelector(sel), SCENE), 15000));
  await wait(2500);
  return !!open;
};

try {
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Key world tools test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  for (const n of [1, 2]) {
    await admin.from("hunt_keys").insert({ hunt_id: huntId, n, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng + (n - 1) * 0.05, area_lat: PLACE.lat, area_radius_m: 1500,
      spot_lng: PLACE.lng + (n - 1) * 0.05, spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
  }
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const ama = await hunter("ama");
  const kofi = await hunter("kofi");

  // 1. Ama in the world: her coins, nobody else yet, the light of the place's own time
  check("Ama: the world opens", await explore(ama.page));
  check("…her coins", (await data(ama.page, "data-coins")) === "500", await data(ama.page, "data-coins"));
  check("…👥 0: nobody else here", (await data(ama.page, "data-others")) === "0");
  const light = Number(await attr(ama.page, "data-daylight"));
  // The sun at the place, now (as src/game/sun.ts works it out)
  const d = Date.now() / 86400000 - 10957.5, R = Math.PI / 180;
  const g = (357.529 + 0.98560028 * d) * R, L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R, e = (23.439 - 0.00000036 * d) * R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ha = (((18.697374558 + 24.06570982441908 * d) % 24) * 15 + PLACE.lng) * R - ra;
  const elev = Math.asin(Math.sin(PLACE.lat * R) * Math.sin(dec) + Math.cos(PLACE.lat * R) * Math.cos(dec) * Math.cos(ha)) / R;
  const want = Math.min(1, Math.max(0, (elev + 6) / 14));
  check("…the light as the sun is at the place now", Math.abs(light - want) < 0.05, `daylight ${light}, the sun ${elev.toFixed(1)}° up there`);
  await ama.page.screenshot({ path: `${OUT}/tools-1-arrive.png` });

  // 2. Her bag: the tools; a torch bought
  await ama.page.evaluate(() => document.querySelector('button[aria-label="Your bag"]')?.click());
  const tools = await until(() => ama.page.evaluate(() => [...document.querySelectorAll('[aria-label="Your bag"] [data-tool]')].map((t) => `${t.getAttribute("data-tool")}:${t.getAttribute("data-owned")}`).join(" ")), 10000);
  check("the bag: the metal detector, the spade and the torch, none owned", tools === "detector:false spade:false torch:false", tools ?? "");
  await ama.page.evaluate(() => [...document.querySelectorAll('[data-tool="torch"] button')][0]?.click());
  const torch = await until(async () => (await ama.page.evaluate(() => document.querySelector('[data-tool="torch"]')?.getAttribute("data-owned"))) === "true", 10000);
  const coinsNow = (await admin.from("profiles").select("coins, torch").eq("id", ama.id).single()).data;
  check("…a torch bought: 60 coins, kept", !!torch && coinsNow.torch === true && coinsNow.coins === 440 && (await data(ama.page, "data-coins")) === "440", JSON.stringify(coinsNow));
  await ama.page.screenshot({ path: `${OUT}/tools-2-bag.png` });
  await ama.page.evaluate(() => document.querySelector('button[aria-label="Close the bag"]')?.click());

  // 3. Kofi joins: Ama sees him; his places stand elsewhere; inside a place he's out of sight
  check("Kofi: the world opens", await explore(kofi.page));
  const counted = await until(async () => (await data(ama.page, "data-others")) === "1", 15000);
  const drawn = await until(async () => (await attr(ama.page, "data-others-shown")) === "1", 15000);
  check("Ama: 👥 1, and Kofi drawn walking", !!counted && !!drawn, `others ${await data(ama.page, "data-others")}, drawn ${await attr(ama.page, "data-others-shown")}`);
  const af = JSON.parse(await attr(ama.page, "data-fronts")), kf = JSON.parse(await attr(kofi.page, "data-fronts"));
  const moved = Object.keys(af).filter((k) => af[k][0] !== kf[k][0] || af[k][1] !== kf[k][1]);
  check("each hunter's places stand on lots of their own (following Kofi leads Ama elsewhere)", moved.length >= 2, `${moved.length} of 5 elsewhere`);
  await tap(kofi.page, { tap: "room", id: "shrine" });
  await until(async () => (await attr(kofi.page, "data-inside")) === "shrine", 20000);
  const hidden = await until(async () => (await attr(ama.page, "data-others-shown")) === "0", 10000);
  check("Kofi inside a place: out of Ama's sight (still counted)", !!hidden && (await data(ama.page, "data-others")) === "1", `drawn ${await attr(ama.page, "data-others-shown")}`);

  // 4. Digging at the water tank: by hand a minute; with a spade at once
  await tap(ama.page, { tap: "room", id: "tank" });
  await until(async () => (await attr(ama.page, "data-inside")) === "tank", 20000);
  await until(() => press(ama.page, "Dig here"), 10000);
  const digging = await until(() => ama.page.evaluate(() => Number(document.querySelector("[data-digging]")?.getAttribute("data-digging") ?? 0)), 10000);
  check("digging by hand: a minute on the spot", digging > 50 && digging <= 60, `${digging} s`);
  await ama.page.screenshot({ path: `${OUT}/tools-3-digging.png` });
  const early = (await ama.c.rpc("house_enter", { p_hunt: huntId, p_room: "tank" })).data;
  check("…the server won't dig it sooner", early?.ok === false && early.reason === "digging" && early.seconds > 40, JSON.stringify(early));
  await press(ama.page, "Buy a spade");
  const spade = await until(async () => (await admin.from("profiles").select("spade, coins").eq("id", ama.id).single()).data?.spade === true, 10000);
  const paid = await until(async () => (await data(ama.page, "data-coins")) === "360", 8000);
  check("…a spade bought there (80 coins)", !!spade && !!paid, await data(ama.page, "data-coins"));
  await press(ama.page, "^Stop$");
  await until(() => press(ama.page, "Dig here"), 10000);
  const chest = await until(async () => /key's chest/.test(await say(ama.page)) && (await say(ama.page)), 10000);
  check("with the spade: dug at once, the key's chest", !!chest, chest ?? (await say(ama.page)));
  await ama.page.screenshot({ path: `${OUT}/tools-4-chest.png` });
  check("no page errors", ama.problems.length + kofi.problems.length === 0, [...ama.problems, ...kofi.problems].join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
