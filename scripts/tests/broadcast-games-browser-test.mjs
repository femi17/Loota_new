// The roadside games on the broadcast (owner, 13 Nov 2026: "I played the card match game, it has 3 rows, only 2 shows on
// the broadcast, and I did not see the option users is picking. Can you check all games display correctly on the
// broadcast, and which option the user chooses"). A hunter in a live test hunt, riding; the owner's broadcast follows
// them on a short screen (1280 × 600). Three sellers stop them in turn, and they play:
//   1. card match: on the broadcast all three rows of cards, whole (none cut off); the two cards they turn over that
//      don't match, up; then a pair they find, matched; then all of them; won;
//   2. the cups: on the broadcast the cup they pick, pointed out;
//   3. mate in one: on the broadcast the piece they pick up, marked; then the move, made on the board; won.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-games-browser-test.mjs
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
const target = { lng: 3.3560, lat: 6.5800 };
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bgames-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const name = `Player${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "motorbike", lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast games test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
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
  const show = await open(browser2, await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: Number(process.env.HEIGHT ?? 600) }); // (HEIGHT=460: a very short one)
  await wait(20000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  await game.evaluate((t) => {
    const m = window.__lootaMap;
    m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
  }, target);
  await wait(4000);

  const clickText = (t) => game.evaluate((x) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((y) => y.textContent?.includes(x) && !y.disabled); b?.click(); return !!b; }, t);
  const CARD = '[aria-label="Scene card"]';
  /** A seller stops them with this game; they agree to play. */
  let leg = 0;
  async function meet(g, npc) {
    // On the move again (a seller only stops someone going somewhere)
    const to = [target, { lng: 3.4100, lat: 6.6000 }, { lng: 3.3300, lat: 6.4900 }][leg++ % 3]; // (far each time: still going when a seller comes)
    await game.evaluate((t) => {
      const m = window.__lootaMap;
      m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
    }, to);
    await wait(3000);
    await admin.from("road_events").insert({ user_id: hunter.id, hunt_id: huntId, kind: "seller", npc, game: g });
    const met = await until(() => clickText("Play · win"), 120000, 1000);
    if (!met) throw new Error(`${npc} never stopped them`);
    await until(() => show.evaluate((s) => !!document.querySelector(`${s} [data-card], ${s} [data-cup-slot], ${s} [data-square]`), CARD), 30000);
  }
  async function goOn() {
    await wait(1500);
    for (let i = 0; i < 20 && !(await clickText("Ride on")) && !(await clickText("Go on")); i++) await wait(500);
    await until(() => show.evaluate((s) => !document.querySelector(s), CARD), 30000);
    await wait(3000);
  }

  // 1. Card match: 12 cards, 3 rows; pairs are i and i + 6
  const pics = ["🥭", "🌶️", "🥥", "🍌", "🐐", "🥁"];
  const cards = [...pics, ...pics];
  await meet({ type: "pairs", cards, misses: 6, seconds: 50 }, "Mama Pairs");
  const flip = (i) => game.evaluate((k) => document.querySelector(`[role="dialog"] [data-card="${k}"]`)?.click(), i);
  const fits = await show.evaluate((s) => {
    const panel = document.querySelector(`${s} > div`)?.getBoundingClientRect();
    const all = [...document.querySelectorAll(`${s} [data-card]`)].map((c) => c.getBoundingClientRect());
    return { n: all.length, inside: all.filter((r) => panel && r.top >= panel.top - 1 && r.bottom <= panel.bottom + 1 && r.bottom <= innerHeight).length, rows: new Set(all.map((r) => Math.round(r.top))).size, scale: document.querySelector(`${s} [data-fit]`)?.getAttribute("data-fit") };
  }, CARD);
  // The stage (owner, 13 Nov 2026: "The game could be bigger… see the time countdown… You can hide the dialogue")
  const stage1 = await show.evaluate(() => ({ stage: !!document.querySelector("[data-game-stage]"), caption: !!document.querySelector('[aria-label="Scene caption"]'), left: Number(document.querySelector("[data-game-left]")?.getAttribute("data-game-left") ?? NaN), fit: Number(document.querySelector("[data-game-stage] [data-fit]")?.getAttribute("data-fit") ?? NaN) }));
  await wait(2500);
  const left2 = await show.evaluate(() => Number(document.querySelector("[data-game-left]")?.getAttribute("data-game-left") ?? NaN));
  check("0. a game on the broadcast: on the stage, the board made bigger, the talk hidden", stage1.stage && !stage1.caption && stage1.fit > (Number(process.env.HEIGHT ?? 600) >= 600 ? 1.05 : 0.4), JSON.stringify(stage1));
  check("…its clock counting down", Number.isFinite(stage1.left) && left2 < stage1.left && stage1.left <= 50, `${stage1.left} → ${left2} s`);
  await show.screenshot({ path: `${OUT}/broadcast-games-0-stage.png` });
  check("1. card match on the broadcast: all 12 cards, 3 rows, none cut off (a short screen: made smaller)", fits.n === 12 && fits.inside === 12 && fits.rows === 3, JSON.stringify(fits));
  await flip(0);
  await wait(250);
  await flip(1);
  const missShown = await until(() => show.evaluate((s) => [...document.querySelectorAll(`${s} [data-card][data-up]`)].map((c) => c.getAttribute("aria-label")), CARD).then((up) => (up.length >= 2 ? up.join(" ") : null)), 20000);
  check("…two cards turned over that don't match: up on the broadcast", missShown === "🥭 🌶️", missShown);
  await show.screenshot({ path: `${OUT}/broadcast-games-1-miss.png` });
  await wait(1000);
  await flip(0);
  await wait(250);
  await flip(6);
  const pairShown = await until(() => show.evaluate((s) => document.querySelectorAll(`${s} [data-card].ring-\\[\\#3DD68C\\]`).length === 2, CARD), 20000);
  check("…then a pair they find: matched on the broadcast", !!pairShown);
  for (const k of [1, 2, 3, 4, 5]) {
    await wait(300);
    await flip(k);
    await wait(250);
    await flip(k + 6);
  }
  const won1 = await until(() => show.evaluate((s) => /wins \d+ coins/i.test(document.querySelector(s)?.textContent ?? "") && document.querySelectorAll(`${s} [data-card].ring-\\[\\#3DD68C\\]`).length === 12, CARD), 25000);
  check("…all of them: all 12 matched on the broadcast, and won", !!won1);
  await goOn();

  // 2. The cups: the one they pick
  await meet({ type: "cups", start: 0, swaps: [[0, 1], [1, 2], [0, 2], [0, 1], [1, 2]], ms: 520, answer: "2", seconds: 6 }, "Tunde Wayo");
  await until(() => game.evaluate(() => { const c = [...document.querySelectorAll('[role="dialog"] [data-cup-slot]')]; return c.length === 3 && c.every((b) => !b.disabled); }), 20000);
  await game.evaluate(() => document.querySelector('[role="dialog"] [data-cup-slot="0"]')?.click()); // the left one (not it)
  const cupShown = await until(() => show.evaluate((s) => document.querySelector(`${s} [data-picked-cup]`)?.closest("[data-cup-slot]")?.getAttribute("data-cup-slot") ?? null, CARD), 20000);
  const cupWords = await until(() => show.evaluate((s) => document.querySelector(s)?.textContent ?? "", CARD).then((t) => (/Picked the cup/.test(t) ? t : null)), 10000) ?? "";
  check("2. the cups: the cup they picked, pointed out on the broadcast", cupShown === "0" && /Picked the cup on the left/.test(cupWords), `${cupShown}; ${cupWords.slice(0, 90)}`);
  await show.screenshot({ path: `${OUT}/broadcast-games-2-cups.png` });
  await goOn();

  // 3. Mate in one: the piece picked up, then the move
  const { data: pz } = await admin.from("chess_puzzles").select("fen, solution, san").limit(1).single();
  await meet({ type: "chess", fen: pz.fen, answer: pz.solution, san: pz.san, seconds: 30 }, "Baba Chess");
  const [from, to] = [pz.solution.slice(0, 2), pz.solution.slice(2, 4)];
  await game.evaluate((s) => document.querySelector(`[role="dialog"] [data-square="${s}"]`)?.click(), from);
  const lifted = await until(() => show.evaluate((s, f) => document.querySelector(`${s} [data-square="${f}"]`)?.className.includes("ring-gold") ?? false, CARD, from), 20000);
  check("3. mate in one: the piece they picked up, marked on the broadcast", !!lifted, from);
  await game.evaluate((s) => document.querySelector(`[role="dialog"] [data-square="${s}"]`)?.click(), to);
  const moved = await until(() => show.evaluate((s, t) => document.querySelector(`${s} [data-square="${t}"]`)?.getAttribute("aria-label") ?? "", CARD, to).then((l) => (/white/.test(l) ? l : null)), 20000);
  const won3 = await until(() => show.evaluate((s) => /wins \d+ coins/i.test(document.querySelector(s)?.textContent ?? ""), CARD), 20000);
  check("…the move, made on the broadcast's board, and won", !!moved && !!won3, `${pz.solution}: ${moved}`);
  await show.screenshot({ path: `${OUT}/broadcast-games-3-chess.png` });
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
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
