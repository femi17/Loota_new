// The hunt's start and the race (phone), in a throwaway hunt: "Starts in", the 10…1 countdown, GO!, the first riddle
// revealed; then a rival: chasing the same key nearby, in the key's area, in the trial, finding the key (news, and the
// player's rank dropping). The hunt and the test players are deleted.   SHOTS=<folder> node scripts/tests/hunt-race-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
const ids = [];
let huntId = null;
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

const yaba = { lng: 3.3787, lat: 6.5186 };
const near = (m) => ({ lng: yaba.lng + m / 110000, lat: yaba.lat });
async function player(tag, at) {
  const email = `race-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ username: `${tag}_${Date.now() % 1000}`, home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 90, updated_at: ago(20) });
  return { id, email, password };
}

try {
  const me = await player("Seeker", yaba);
  const rival = await player("Ada", near(500));
  const spot = near(2500);
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Race test (automated)", prize: "none", winners: 3, starts_at: soon(45), ends_at: soon(7200), published: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert([
    { hunt_id: huntId, n: 1, riddle: "Where the test riddle points, two and a half kilometres east of Yaba.", category: "maths", area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, spot_lng: spot.lng, spot_lat: spot.lat },
    { hunt_id: huntId, n: 2, riddle: "The second test riddle.", category: "maths", area_lng: yaba.lng, area_lat: yaba.lat, area_radius_m: 800, spot_lng: yaba.lng, spot_lat: yaba.lat },
  ]);
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: me.id });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: me.email, password: me.password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  // Every toast, from the moment the page loads (they fade).
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      for (const p of document.querySelectorAll("p.loota-wonder-banner")) if (!window.__toasts.includes(p.textContent)) window.__toasts.push(p.textContent);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const body = () => page.evaluate(() => document.body.innerText);
  const toasts = () => page.evaluate(() => window.__toasts);
  const shot = (name) => page.screenshot({ path: `${OUT}/race-${name}.png` });

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  const before = await text('[aria-label="Hunt"]');
  check("before the start: Starts in m:ss", /Starts in \d:\d\d/.test(before ?? ""), before);
  await shot("0-starts-in");
  let counted = false;
  for (let i = 0; i < 60 && !counted; i++) {
    counted = /the hunt starts in/i.test(await body()); // (styled in capitals)
    if (!counted) await wait(500);
  }
  check("the last ten seconds: the countdown", counted);
  await shot("1-countdown");
  let went = false;
  for (let i = 0; i < 40 && !went; i++) {
    went = /GO!/.test(await body());
    if (!went) await wait(400);
  }
  check("GO!", went);
  let riddle = null;
  for (let i = 0; i < 20 && !riddle; i++) {
    riddle = await text('[aria-label="The first riddle"]');
    if (!riddle) await wait(500);
  }
  check("the first riddle, revealed", /key 1 of 2/i.test(riddle ?? "") && /two and a half kilometres/.test(riddle ?? ""), riddle);
  await shot("2-riddle");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Let's go"))?.click());

  // ---- A rival
  const rc = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await rc.auth.signInWithPassword({ email: rival.email, password: rival.password });
  await rc.rpc("join_hunt", { p_hunt: huntId });
  await admin.from("player_positions").update({ updated_at: new Date().toISOString() }).eq("user_id", rival.id);
  await wait(9000);
  const card = await text('[aria-label="Your rivals"]');
  check("a rival chasing the same key, 500 m off", /Ada_\d+/.test(card ?? "") && /chasing the same key · [45]\d\d m/.test(card ?? ""), card);
  check("news: they joined", (await toasts()).some((t) => /Ada_\d+ joined the hunt/.test(t)), JSON.stringify(await toasts()));
  await admin.from("hunt_players").update({ approach_key: 1 }).eq("hunt_id", huntId).eq("user_id", rival.id);
  await wait(8000);
  check("they're in my key's area", /1 hunter is already in your key's area/.test((await text('[aria-label="Your rivals"]')) ?? ""));
  await shot("3-rival");

  // They reach the key and start its trial, then earn it.
  await admin.from("player_positions").update({ lng: spot.lng, lat: spot.lat, updated_at: ago(30) }).eq("user_id", rival.id);
  const found = await rc.rpc("search_here", { p_hunt: huntId, p_lng: spot.lng, p_lat: spot.lat, p_mode: "walk" });
  check("(the rival is in the trial)", found.data?.result === "trial", JSON.stringify(found.data ?? found.error));
  await wait(8000);
  check("news: the rival is in the Key 1 trial, with the distance", (await toasts()).some((t) => /Ada_\d+ is in the Key 1 trial · [\d.]+ k?m from you/.test(t)), JSON.stringify(await toasts()));
  // (In play the database stamps it; this computer's clock may lag the database's a little.)
  const { error: passErr } = await admin.from("trial_attempts").update({ status: "passed", ended_at: soon(2) }).eq("hunt_id", huntId).eq("user_id", rival.id);
  if (passErr) throw passErr;
  await admin.from("hunt_players").update({ keys_held: 1, last_key_at: new Date().toISOString(), approach_key: null }).eq("hunt_id", huntId).eq("user_id", rival.id);
  await wait(8000);
  const news = await toasts();
  check("news: the rival found Key 1", news.some((t) => /🔑 Ada_\d+ found Key 1/.test(t)), JSON.stringify(news));
  check("…and I dropped to 2nd", news.some((t) => /You dropped to 2nd/.test(t)));
  await shot("4-news");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    const { error } = await admin.from("hunts").delete().eq("id", huntId);
    if (error) console.log("hunt cleanup failed:", error.message);
  }
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
