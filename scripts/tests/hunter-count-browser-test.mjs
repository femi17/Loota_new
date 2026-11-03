// How many hunters are in the hunt, on the map (owner, 3 Nov 2026: "we should see a count of all the hunters who joined
// the hunt"): a player not in HUNT (default: the endless test hunt) sees "N hunters" on its invite; once joined, the
// hunt card shows 👥 N and the leaderboard "Leaderboard · N hunters", N being everyone who joined. Test players deleted.
//   HUNT=<id> SHOTS=<folder> node scripts/tests/hunter-count-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const HUNT = process.env.HUNT ?? "d4c65372-1efb-4232-a399-d819e059be80";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const NL = String.fromCharCode(10);
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 };
const count = async () => (await admin.from("hunt_players").select("user_id", { count: "exact", head: true }).eq("hunt_id", HUNT)).count;

async function player(tag) {
  const email = `${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", data.user.id);
  await admin.from("player_positions").upsert({ user_id: data.user.id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  return { id: data.user.id, c, jar };
}

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const open = async (p, path) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...p.jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => {
      try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
    }, p.id);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
    return page;
  };

  // ---- Not in the hunt: the invite
  const outsider = await player("count-out");
  let page = await open(outsider, "/play");
  const n0 = await count();
  const invite = await page.evaluate((nl) => document.querySelector('[aria-label="A hunt is live"]')?.innerText.split(nl).join(" | ") ?? "", NL);
  check(`the invite: "${n0} hunters"`, invite.includes(`${n0} hunter${n0 === 1 ? "" : "s"}`), invite);
  await page.screenshot({ path: `${OUT}/hunter-count-1-invite.png` });
  await page.close();

  // ---- In the hunt: the card and the leaderboard
  const hunter = await player("count-in");
  const joined = await hunter.c.rpc("join_hunt", { p_hunt: HUNT });
  check("joined the hunt", !joined.error, joined.error?.message);
  page = await open(hunter, `/play?hunt=${HUNT}`);
  const n1 = await count();
  let shown = null;
  for (let i = 0; i < 20 && shown === null; i++) {
    shown = await page.evaluate(() => document.querySelector("[data-hunters]")?.getAttribute("data-hunters") ?? null);
    if (shown === null) await wait(500);
  }
  check(`the hunt card: 👥 ${n1}, everyone who joined`, Number(shown) === n1, `${shown} shown, ${n1} joined`);
  await page.screenshot({ path: `${OUT}/hunter-count-2-card.png` });
  await page.evaluate(() => document.querySelector('button[aria-label="Leaderboard"]')?.click());
  await wait(1500);
  const heading = await page.evaluate(() => [...document.querySelectorAll("p")].map((p) => p.textContent ?? "").find((t) => /^Leaderboard/.test(t.trim())) ?? "");
  check(`the leaderboard: "Leaderboard · ${n1} hunters"`, heading.includes(`${n1} hunter${n1 === 1 ? "" : "s"}`), heading.trim());
  await page.screenshot({ path: `${OUT}/hunter-count-3-board.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
