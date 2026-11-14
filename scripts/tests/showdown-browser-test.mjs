// Showdowns (owner, 14 Nov 2026: "if you have a key now. It should in the leaderboard… there as to be a relic, that shows
// people your location. and when they are close to you. It will be like a showdown… the thief challenges you, you have a
// category… you pick one, then the puzzle is shown… if you lose maybe the thief steals your key"). In a live test hunt:
// A holds Key 1; B (no keys) has a Tracker out, 20 m from A; the owner's broadcast follows A.
//   1. B's Tracker shows A (and their key); A is warned someone's tracking;
//   2. B sees "Challenge A" and challenges (50 coins at stake); A is asked to pick the battle, and picks;
//   3. both get the same puzzle after the countdown; the broadcast shows the showdown;
//   4. B gets it wrong once, then right: B steals Key 1 (A back to win it again, its place kept for them); both told;
//      the broadcast shows the steal.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/showdown-browser-test.mjs
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
const start = { lng: 3.3787, lat: 6.5186 };
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `showdown-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const a = await user("a"), b = await user("b");
  const aName = `Holder${Date.now() % 1000}`, bName = `Thief${Date.now() % 1000}`;
  const bAt = { lng: start.lng + 20 / (111320 * Math.cos((start.lat * Math.PI) / 180)), lat: start.lat };
  for (const [u, name, at] of [[a, aName, start], [b, bName, bAt]]) {
    await admin.from("profiles").update({ username: name, home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString(), coins: 1000 }).eq("id", u.id);
    await admin.from("player_positions").upsert({ user_id: u.id, lng: at.lng, lat: at.lat, mode: "walk", energy: 100, updated_at: ago(5) });
  }
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Showdown test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  for (let n = 1; n <= 3; n++) await admin.from("hunt_keys").insert({ hunt_id: huntId, n, riddle: `Test key ${n}.`, category: "maths", area_lng: 3.40 + n * 0.02, area_lat: 6.55, area_radius_m: 800, spot_lng: 3.40 + n * 0.02, spot_lat: 6.55 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: a.id, joined_at: ago(3000), keys_held: 1, last_key_at: ago(1500), guess_n: 2, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: b.id, joined_at: ago(3000), keys_held: 0, guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });
  await admin.from("player_boosts").upsert({ user_id: b.id, tracker_until: new Date(Date.now() + 600e3).toISOString() });

  browser = await launch();
  browser2 = await launch();
  const problems = [];
  const open = async (br, jar, path, viewport, uid) => {
    const page = await (await br.createBrowserContext()).newPage();
    await page.setViewport(viewport);
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    if (uid) await page.evaluateOnNewDocument((id, h) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); localStorage.setItem(`loota:riddle-seen:${h}`, "1"); } catch {} }, uid, huntId);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    return page;
  };
  const phone = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  const pa = await open(browser, await signedIn(a), `/play?hunt=${huntId}`, phone, a.id);
  const pb = await open(browser, await signedIn(b), `/play?hunt=${huntId}`, phone, b.id);
  const show = await open(browser2, await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 720 });
  for (const p of [pa, pb]) await until(() => p.evaluate(() => !!window.__lootaMap).catch(() => false), 120000, 1000);
  await wait(6000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), aName);
  const text = (p) => p.evaluate(() => document.body.innerText);

  // 1. The Tracker; the warning
  const tracked = await until(() => pb.evaluate((n) => { const el = document.querySelector("[data-tracker]"); return el && el.textContent?.includes(n) ? el.textContent : null; }, aName), 40000, 1000);
  check("1. B's Tracker: A, with their key, and how far", !!tracked && /🗝 1/.test(tracked) && /\d+ m/.test(tracked), tracked);
  const warned = await until(async () => /has a Tracker out near you/.test(await text(pa)), 30000, 1000);
  check("…A is warned someone's tracking", !!warned);
  await pb.screenshot({ path: `${OUT}/showdown-1-tracker.png` });

  // 2. The challenge; A picks the battle
  const challenged = await until(() => pb.evaluate((id) => { const btn = document.querySelector(`[data-challenge="${id}"]`); btn?.click(); return !!btn; }, a.id), 60000, 1000);
  check("2. near A, B sees \"Challenge\" and challenges", !!challenged);
  const asked = await until(() => pa.evaluate(() => document.querySelector('[data-showdown="challenged"]')?.textContent ?? null), 30000, 500);
  check("…A is challenged: pick the battle, or run", !!asked && /challenges you/.test(asked) && /Run/.test(asked), asked?.slice(0, 120));
  await pa.screenshot({ path: `${OUT}/showdown-2-challenged.png` });
  const coinsB = (await admin.from("profiles").select("coins").eq("id", b.id).single()).data.coins;
  check("…50 coins at stake from B", Number(coinsB) === 950, coinsB);
  const picked = await pa.evaluate(() => {
    const prefer = ["flags", "brands", "grammar", "algebra", "vowels"];
    const btn = [...document.querySelectorAll("[data-showdown-pick]")].find((x) => prefer.includes(x.getAttribute("data-showdown-pick")));
    btn?.click();
    return btn?.getAttribute("data-showdown-pick") ?? null;
  });
  check("…A picks a battle", !!picked, picked);

  // 3. The same puzzle for both
  const boards = await until(async () => {
    const x = await pa.evaluate(() => document.querySelector("[data-showdown-board]")?.getAttribute("data-showdown-board") ?? null);
    const y = await pb.evaluate(() => document.querySelector("[data-showdown-board]")?.getAttribute("data-showdown-board") ?? null);
    return x && y ? [x, y] : null;
  }, 30000, 500);
  check("3. after the countdown, both on the same puzzle", !!boards && boards[0] === picked && boards[1] === picked, JSON.stringify(boards));
  await pb.screenshot({ path: `${OUT}/showdown-3-race.png` });
  // 4. B: wrong, then right
  const sd = await until(async () => (await admin.from("showdowns").select("id, solution").eq("thief", b.id).single()).data?.solution ? (await admin.from("showdowns").select("id, solution").eq("thief", b.id).single()).data : null, 15000, 500);
  const solve = (answer) => pb.evaluate(async (id, ans) => (await fetch("/api/showdown/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, answer: ans }) })).json(), sd.id, answer);
  const wrong = await solve(Array.isArray(sd.solution) ? sd.solution.map((x) => (typeof x === "number" ? x + 1 : "zzz")) : null);
  check("4. B's first answer wrong: one more try", wrong?.result === "wrong" && wrong?.triesLeft === 1, JSON.stringify(wrong));
  const right = await solve(sd.solution);
  check("…then right: B wins", right?.result === "won", JSON.stringify(right));
  const onShow = await until(() => show.evaluate(() => document.querySelector("[data-showdown-shown]")?.textContent ?? null), 30000, 500);
  check("…the broadcast shows the showdown", !!onShow && onShow.includes(aName) && onShow.includes(bName), onShow?.slice(0, 160));
    await show.screenshot({ path: `${OUT}/showdown-3-broadcast.png` });

  const resB = await until(() => pb.evaluate(() => document.querySelector("[data-showdown-result]")?.textContent ?? null), 20000, 500);
  const resA = await until(() => pa.evaluate(() => document.querySelector("[data-showdown-result]")?.textContent ?? null), 20000, 500);
  check("…B told they won the key; A that it was taken", /Key 1 is yours/.test(resB ?? "") && /took your Key 1/.test(resA ?? ""), `${resB} / ${resA}`);
  const hpA = (await admin.from("hunt_players").select("keys_held, guess_n, guess_name").eq("hunt_id", huntId).eq("user_id", a.id).single()).data;
  const hpB = (await admin.from("hunt_players").select("keys_held").eq("hunt_id", huntId).eq("user_id", b.id).single()).data;
  check("…A back before Key 1 (its place kept for them), B holds Key 1", hpA.keys_held === 0 && hpA.guess_n === 1 && /taken by/.test(hpA.guess_name ?? "") && hpB.keys_held === 1, `${JSON.stringify(hpA)} · ${JSON.stringify(hpB)}`);
  const stolenShown = await until(() => show.evaluate(() => document.querySelector("[data-showdown-shown]")?.textContent ?? null).then((t) => (/steals Key 1/.test(t ?? "") ? t : null)), 30000, 500);
  check("…the broadcast: B steals Key 1", !!stolenShown, stolenShown?.slice(0, 160));
  await pa.screenshot({ path: `${OUT}/showdown-4-lost.png` });
  await show.screenshot({ path: `${OUT}/showdown-4-broadcast.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  if (huntId) {
    await admin.from("showdowns").delete().eq("hunt_id", huntId);
    await admin.from("hunt_events").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("player_boosts").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
