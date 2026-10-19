// Games on the road (phone, owner 19 Oct 2026): riding along in free roam, passers-by stop you to play: mate in one
// (tap the piece and the square: checkmate, 25 coins), the three cups (watch the shuffle, tap the cup with the coin:
// 25 coins), pairs (turn the cards, all six pairs: 25 coins); a traveller you've helped offers one too (lost here on
// purpose: the wrong cup). Each is planted, then met on the move. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/road-games-browser-test.mjs
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
const start = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `roadgames-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: true, light: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "bicycle", energy: 100, updated_at: ago(20) });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const plant = (kind, npc, game) => admin.from("road_events").insert({ user_id: id, kind, npc, game });

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
  const scene = () => page.evaluate((nl) => document.querySelector('[role="dialog"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const click = (sel) => page.evaluate((s) => { const b = document.querySelector(s); b?.click(); return !!b; }, sel);
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((y) => y.textContent?.includes(x) && !y.disabled); b?.click(); return !!b; }, t);
  const clickWhenThere = async (x) => {
    for (let i = 0; i < 24; i++) {
      if (await clickText(x)) return true;
      await wait(500);
    }
    return false;
  };
  const until = async (re, tries = 30) => {
    let s = null;
    for (let i = 0; i < tries && !re.test(s ?? ""); i++) {
      await wait(500);
      s = await scene();
    }
    return s;
  };
  const shot = (name) => page.screenshot({ path: `${OUT}/games-${name}.png` });
  async function rideUntilStopped() {
    await page.keyboard.down("ArrowUp");
    let s = null;
    for (let i = 0; i < 90 && !s; i++) {
      await wait(1000);
      s = await scene();
    }
    await page.keyboard.up("ArrowUp");
    await wait(4500);
    return scene();
  }

  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);

  // ---- Mate in one
  await plant("seller", "Baba Sola", { type: "chess", fen: "4k3/4pp2/8/6P1/6Q1/8/5PPP/6K1 w - - 0 1", answer: "g4c8", san: "Qc8#" });
  const ch = await rideUntilStopped();
  check("a chess player by the road: mate in one for 25 coins", /Mate in one/i.test(ch ?? "") && /25 coins/.test(ch ?? ""), ch);
  check("…Play", await clickWhenThere("Play · win 25"));
  await wait(800);
  check("…the board: 64 squares, the white queen on g4", await page.evaluate(() => document.querySelectorAll("[data-square]").length === 64 && !!document.querySelector('[data-square="g4"][aria-label*="white q"]')));
  await shot("1-chess");
  await click('[data-square="g4"]');
  await wait(300);
  let c0 = await coins();
  await click('[data-square="c8"]');
  const mate = await until(/Checkmate!/);
  check("Qc8: checkmate, 25 coins", /Checkmate! Qc8#/.test(mate ?? "") && (await coins()) === c0 + 25, mate?.slice(0, 160));
  await shot("2-mate");
  await clickWhenThere("Go on");
  await wait(1500);

  // ---- The three cups
  const swaps = [[0, 1], [1, 2], [0, 2], [0, 1], [1, 2]];
  let at = 2;
  for (const [a, b] of swaps) at = at === a ? b : at === b ? a : at;
  await plant("seller", "Tunde Wayo", { type: "cups", start: 2, swaps, ms: 520, answer: String(at) });
  const cu = await rideUntilStopped();
  check("a cups man: find the coin for 25 coins", /coin goes under one cup/.test(cu ?? ""), cu);
  await clickWhenThere("Play · win 25");
  await wait(900);
  await shot("3-cups-shown");
  await wait(1800);
  await shot("4-cups-shuffling");
  let ready = false;
  for (let i = 0; i < 20 && !ready; i++) {
    await wait(300);
    ready = await page.evaluate(() => [...document.querySelectorAll("[data-cup-slot]")].every((b) => !b.disabled));
  }
  check("…the shuffle ends: pick a cup", ready);
  c0 = await coins();
  await click(`[data-cup-slot="${at}"]`);
  const found = await until(/You found it/);
  check(`the cup where the coin went (${["left", "middle", "right"][at]}): 25 coins`, /You found it/.test(found ?? "") && (await coins()) === c0 + 25, found?.slice(0, 160));
  await shot("5-cups-found");
  await clickWhenThere("Go on");
  await wait(1500);

  // ---- Pairs
  const cards = ["🥭", "🐐", "🥭", "⚽", "🐐", "🍌", "⚽", "🥁", "🍌", "🛺", "🥁", "🛺"];
  await plant("seller", "Little Bisi", { type: "pairs", cards, misses: 6 });
  const pa = await rideUntilStopped();
  check("children with cards: pairs for 25 coins", /six pairs/.test(pa ?? ""), pa);
  await clickWhenThere("Play · win 25");
  await wait(800);
  c0 = await coins();
  // One miss first (it turns back), then every pair.
  await click('[data-card="0"]');
  await click('[data-card="1"]');
  await wait(1000);
  for (const [a, b] of [[0, 2], [1, 4], [3, 6], [5, 8], [7, 10], [9, 11]]) {
    await click(`[data-card="${a}"]`);
    await click(`[data-card="${b}"]`);
    await wait(250);
  }
  const all = await until(/All the pairs/);
  check("one miss, then all six pairs: 25 coins", /All the pairs/.test(all ?? "") && (await coins()) === c0 + 25, all?.slice(0, 160));
  await shot("6-pairs");
  await clickWhenThere("Go on");
  await wait(1500);

  // ---- A traveller, helped, offers a game: lost on purpose
  await plant("traveller", "Blessing", { type: "cups", start: 0, swaps: [[0, 1], [1, 2], [0, 1], [0, 2], [1, 2]], ms: 520, answer: "1" });
  const tr = await rideUntilStopped();
  check("a stranded traveller", /My phone died/.test(tr ?? ""), tr);
  await clickWhenThere("Of course, let me help");
  const offer = await until(/20 coins if you do/);
  check("…helped, they offer a game for 20 coins", /Before you go, a game\?.*20 coins/.test(offer ?? ""), offer?.slice(0, 200));
  await clickWhenThere("Play · win 20");
  ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    await wait(300);
    ready = await page.evaluate(() => [...document.querySelectorAll("[data-cup-slot]")].every((b) => !b.disabled));
  }
  c0 = await coins();
  await click('[data-cup-slot="2"]'); // not where it went (the middle)
  const lost = await until(/It was under the middle cup/);
  check("…the wrong cup: told where it was, nothing paid", /It was under the middle cup/.test(lost ?? "") && (await coins()) === c0, lost?.slice(0, 160));
  await shot("7-traveller-lost");
  await clickWhenThere("Go on");
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
