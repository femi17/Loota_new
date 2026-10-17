// Road events in a hunt (phone): riding along, the game stops the hunter for a police checkpoint (answered wrong: a
// 20-coin fine), a stranded traveller (helped: which way the key's area is) and a street seller's riddle (answered
// right: 25 coins). Each is planted, then met after 45 s on the move. The hunt and the test player are deleted.
//   SHOTS=<folder> node scripts/tests/road-events-browser-test.mjs
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

const start = { lng: 3.3787, lat: 6.5186 };
try {
  const email = `road-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 100, p_kind: "admin", p_reason: "Road events test" });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 100, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Road events test (automated)", prize: "none", winners: 3, starts_at: ago(600), ends_at: soon(7200), published: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The test key, far to the north-east.", category: "maths", area_lng: 3.45, area_lat: 6.58, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.58 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const plant = (kind, npc, question) => admin.from("road_events").insert({ user_id: id, hunt_id: huntId, kind, npc, question });

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
  const scene = () => page.evaluate((nl) => document.querySelector('[role="dialog"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((y) => y.textContent?.includes(x) && !y.disabled); b?.click(); return !!b; }, t);
  /** Click a reply once it shows (replies appear when the line has finished typing out). */
  const clickWhenThere = async (x) => {
    for (let i = 0; i < 20; i++) {
      if (await clickText(x)) return true;
      await wait(500);
    }
    return false;
  };
  const shot = (name) => page.screenshot({ path: `${OUT}/road-${name}.png` });
  /** Ride on until a scene stops the hunter (at most ~80 s). */
  async function rideUntilStopped() {
    await page.keyboard.down("ArrowUp");
    let s = null;
    for (let i = 0; i < 80 && !s; i++) {
      await wait(1000);
      s = await scene();
    }
    await page.keyboard.up("ArrowUp");
    await wait(3500); // the first line types out
    return scene();
  }

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);

  // ---- A police checkpoint: answered wrong
  await plant("checkpoint", "Officer Bello", { prompt: "What does a red traffic light mean?", choices: ["Go faster", "Stop", "Turn left only"], answer: 1 });
  const cp = await rideUntilStopped();
  check("riding along: stopped at a police checkpoint", /Police checkpoint/i.test(cp ?? "") && /red traffic light/.test(cp ?? ""), cp);
  await shot("1-checkpoint");
  const before = await coins();
  await clickText("Go faster");
  await wait(2500);
  check("wrong: a 20-coin fine", /That's a 20-coin fine/.test((await scene()) ?? "") && (await coins()) === before - 20);
  await clickWhenThere("Go on");
  await wait(1000);

  // ---- A stranded traveller: helped
  await plant("traveller", "Blessing", null);
  const tr = await rideUntilStopped();
  check("a stranded traveller", /My phone died/.test(tr ?? ""), tr);
  await shot("2-traveller");
  await clickText("Of course, let me help");
  await wait(2500);
  check("helped: which way the key's area lies", /to the north-east of here/.test((await scene()) ?? ""), await scene());
  await clickWhenThere("Go on");
  await wait(1000);

  // ---- A street seller's riddle: answered right
  await plant("seller", "Mama Titi", { prompt: "Ibadan is the capital of which state?", choices: ["Oyo", "Ogun", "Ondo", "Osun"], answer: 0 });
  const se = await rideUntilStopped();
  check("a street seller's riddle", /answer my riddle/.test(se ?? "") && /Ibadan/.test(se ?? ""), se);
  await shot("3-seller");
  const mid = await coins();
  await clickText("Oyo");
  await wait(2500);
  check("right: 25 coins", /Take your 25 coins/.test((await scene()) ?? "") && (await coins()) === mid + 25);
  await clickWhenThere("Go on");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (ids.length) await admin.from("road_events").delete().in("user_id", ids);
  if (huntId) {
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
