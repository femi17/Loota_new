// The hunt, part 5 (phone), staged in a throwaway hunt that began 33 minutes ago (golden minutes on): a leader has
// finished and the player has been stuck 20 minutes (a catch-up tip); a rival is already in the key's trial when the
// player's begins (a showdown); answered right: first to the key, golden minutes and the showdown (+200), then the
// recap card. The hunt and the test players are deleted.   SHOTS=<folder> node scripts/tests/hunt-drama-browser-test.mjs
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

const spot = { lng: 3.378214, lat: 6.500147 };
const QUESTIONS = [
  { prompt: "12 + 30 = ?", choices: ["40", "42", "44", "41"], answer: 1 },
  { prompt: "Which is NOT a fruit?", choices: ["Mango", "Yam", "Orange", "Guava"], answer: 1 },
];
async function player(tag) {
  const email = `drama-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ username: `${tag}_${Date.now() % 1000}`, home_lng: spot.lng, home_lat: spot.lat + 0.01, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat + 0.004, mode: "walk", energy: 90, updated_at: ago(20) });
  return { id, email, password };
}

try {
  const me = await player("Seeker");
  const rival = await player("Ada");
  const leader = await player("Tunde");
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Drama test (automated)", prize: "none", winners: 3, starts_at: ago(33 * 60), ends_at: soon(7200), published: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The one test key, by a bus stop.", category: "general", area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, spot_lng: spot.lng, spot_lat: spot.lat });
  const { error: playersErr } = await admin.from("hunt_players").insert([
    // (rows inserted together need the same columns: missing ones would be null, not their defaults)
    { hunt_id: huntId, user_id: me.id, joined_at: ago(20 * 60), keys_held: 0, finished_at: null, place: null },
    { hunt_id: huntId, user_id: rival.id, joined_at: ago(25 * 60), keys_held: 0, finished_at: null, place: null },
    // The leader has finished (no trial on record: the player can still be first to the key's trial).
    { hunt_id: huntId, user_id: leader.id, joined_at: ago(30 * 60), keys_held: 1, finished_at: ago(60), place: 1 },
  ]);
  if (playersErr) throw playersErr;
  // The rival is already in the key's trial.
  const { error: rivalErr } = await admin.from("trial_attempts").insert({ hunt_id: huntId, user_id: rival.id, key_n: 1, questions: QUESTIONS, started_at: ago(5), asked_at: ago(5) });
  if (rivalErr) throw rivalErr;

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
  await page.evaluateOnNewDocument((h) => {
    try { localStorage.setItem(`loota:riddle-seen:${h}`, "1"); } catch {}
    window.__toasts = [];
    new MutationObserver(() => {
      for (const p of document.querySelectorAll("p.loota-wonder-banner")) if (!window.__toasts.includes(p.textContent)) window.__toasts.push(p.textContent);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, huntId);
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const shot = (name) => page.screenshot({ path: `${OUT}/drama-${name}.png` });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", me.id).single()).data.coins;

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(16000);
  const golden = await text('[aria-label="Golden minutes"]');
  check("golden minutes on the card", /Golden minutes · \d:\d\d left/.test(golden ?? ""), golden);
  const tipLine = await text('[aria-label="A tip"]');
  check("a catch-up tip for the trailing hunter", /A tip: Key 1's area lies [a-z-]+ of where you were/.test(tipLine ?? ""), tipLine);
  check("…and its toast", (await page.evaluate(() => window.__toasts)).some((t) => /A tip for the chase/.test(t)));
  await shot("1-card");

  // ---- The player's trial begins (as if the chest were opened) while the rival's is on: a showdown
  const before = await coins();
  await admin.from("trial_attempts").insert({ hunt_id: huntId, user_id: me.id, key_n: 1, questions: QUESTIONS });
  await page.evaluate(() => window.dispatchEvent(new Event("loota:hunt-changed")));
  await wait(2500);
  const banner = await text('[aria-label="Showdown"]');
  check("a showdown banner in the trial", /Showdown! Ada_\d+ is in this trial too/.test(banner ?? ""), banner);
  await shot("2-showdown");
  for (const pick of ["42", "Yam"]) {
    await page.evaluate((x) => [...document.querySelector('[aria-label="Key Trial"]').querySelectorAll("button")].find((b) => b.textContent === x)?.click(), pick);
    await wait(2500);
  }
  const bonuses = await text('[aria-label="Bonuses"]');
  check("finished: first to the key, golden minutes, the showdown", /First to this key: \+100/.test(bonuses ?? "") && /Golden minutes: \+50/.test(bonuses ?? "") && /Showdown won against Ada_\d+: \+50/.test(bonuses ?? ""), bonuses);
  check("…+200 coins", (await coins()) === before + 200, String((await coins()) - before));
  await shot("3-bonuses");

  // ---- The recap
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Your hunt, in one card"))?.click());
  await wait(2500);
  const card = await text('[aria-label="Your hunt"]');
  check("the recap: 2nd of 3, Key 1's time, medals, +200", /2nd/.test(card ?? "") && /of 3 hunters/.test(card ?? "") && /Key 1/.test(card ?? "") && /\+200 coins/.test(card ?? ""), card);
  await shot("4-recap");
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
