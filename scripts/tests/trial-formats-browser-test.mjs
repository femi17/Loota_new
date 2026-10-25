// The Key Trial's new kinds of question (phone): memorise (shown for 3 s, then hidden), count (a row of fruit), and
// unscramble (letter tiles); each answered right, the key is earned. A trial is laid for a test player in a throwaway
// hunt. The hunt and the test player are deleted.   SHOTS=<folder> node scripts/tests/trial-formats-browser-test.mjs
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
// An answer already locked in for the first riddle (the riddle clock), far from any key: tests start at the chest.
const LOCKED = { guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 };
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

const QUESTIONS = [
  { prompt: "Which one was NOT there?", choices: ["🛵", "🎩", "⚽", "🐐"], answer: 1, show: "🛵 🐐 ⚽ 🌴 📱", showSeconds: 3 },
  { prompt: "How many 🥭 do you see?", choices: ["5", "7", "6", "8"], answer: 2, show: "🥭 🥭 🥥 🥭 🥭 🌶 🥥 🥥 🥭 🥭" },
  { prompt: "Unscramble: L I N I R O", choices: ["Jollof", "Ibadan", "Ilorin", "Owerri"], answer: 2 },
];
const yaba = { lng: 3.3787, lat: 6.5186 };
try {
  const email = `formats-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 90, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Formats test (automated)", prize: "none", winners: 3, starts_at: ago(600), ends_at: soon(7200), published: true, questions_per_trial: 3, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert([
    { hunt_id: huntId, n: 1, riddle: "The test key.", category: "general", area_lng: yaba.lng, area_lat: yaba.lat, area_radius_m: 800, spot_lng: yaba.lng, spot_lat: yaba.lat },
    { hunt_id: huntId, n: 2, riddle: "The second test key.", category: "general", area_lng: 3.39, area_lat: 6.53, area_radius_m: 800, spot_lng: 3.39, spot_lat: 6.53 },
  ]);
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, ...LOCKED });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((h) => {
    try { localStorage.setItem(`loota:riddle-seen:${h}`, "1"); } catch {}
  }, huntId);
  const trialText = () => page.evaluate((nl) => document.querySelector('[aria-label="Key Trial"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const pick = (label) => page.evaluate((x) => { const b = [...document.querySelector('[aria-label="Key Trial"]').querySelectorAll("button")].find((y) => y.textContent === x && !y.disabled); b?.click(); return !!b; }, label);
  const shot = (name) => page.screenshot({ path: `${OUT}/formats-${name}.png` });

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  // The trial begins (as if the chest had been opened): the page hears of it on its next look.
  await admin.from("trial_attempts").insert({ hunt_id: huntId, user_id: id, key_n: 1, questions: QUESTIONS });
  await page.evaluate(() => window.dispatchEvent(new Event("loota:hunt-changed")));
  let t = null;
  for (let i = 0; i < 20 && !t; i++) {
    t = await trialText();
    if (!t) await wait(250);
  }
  // ---- Memorise
  check("memory: the things to memorise, then hidden", /Memorise!/i.test(t ?? "") && /🛵 🐐 ⚽ 🌴 📱/.test(t ?? "") && !/Which one was NOT there/.test(t ?? ""), t);
  await shot("1-memorise");
  await wait(3500);
  const asked = await trialText();
  check("…then the question, the things gone", /Which one was NOT there\?/.test(asked ?? "") && !/🌴 📱/.test(asked ?? ""), asked);
  await shot("2-memory-question");
  await pick("🎩");
  await wait(2500);
  // ---- Count
  const count = await trialText();
  check("count: the row of fruit with the question", /How many 🥭 do you see\?/.test(count ?? "") && /🥭 🥭 🥥/.test(count ?? ""), count);
  await shot("3-count");
  await pick("6");
  await wait(2500);
  // ---- Unscramble
  const tiles = await page.evaluate(() => document.querySelector('[aria-label^="Letters:"]')?.children.length ?? 0);
  check("unscramble: six letter tiles", tiles === 6, String(tiles));
  await shot("4-scramble");
  await pick("Ilorin");
  await wait(3000);
  const result = await page.evaluate((nl) => document.querySelector('[aria-label="Key Trial result"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  check("all three right: Key 1 earned", /Key 1 earned!/.test(result ?? ""), result);
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
