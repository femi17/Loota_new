// Road events in free roam (phone, no hunt): riding a motorbike with no helmet, licence or registration, a police
// checkpoint stops you and the only way on is the fine (20 coins for each: 60); a stranded traveller helped pays you
// 15 coins. Each is planted, then met on the move. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/free-roam-events-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

const start = { lng: 3.3787, lat: 6.5186 };
try {
  const email = `roam-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 100, p_kind: "admin", p_reason: "Free roam events test" });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 100, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const plant = (kind, npc, question, missing = []) => admin.from("road_events").insert({ user_id: id, kind, npc, question, missing });

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
  const scene = () => page.evaluate((nl) => document.querySelector('[role="dialog"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((y) => y.textContent?.includes(x) && !y.disabled); b?.click(); return !!b; }, t);
  const clickWhenThere = async (x) => {
    for (let i = 0; i < 20; i++) {
      if (await clickText(x)) return true;
      await wait(500);
    }
    return false;
  };
  const shot = (name) => page.screenshot({ path: `${OUT}/roam-${name}.png` });
  async function rideUntilStopped() {
    await page.keyboard.down("ArrowUp");
    let s = null;
    for (let i = 0; i < 80 && !s; i++) {
      await wait(1000);
      s = await scene();
    }
    await page.keyboard.up("ArrowUp");
    await wait(4500); // the first line types out
    return scene();
  }

  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);

  // ---- A checkpoint, and no papers: the fine
  await plant("checkpoint", "Sergeant Ade", { prompt: "What does a red traffic light mean?", choices: ["Go faster", "Stop", "Turn left only"], answer: 1 }, ["helmet", "rider_licence", "registration"]);
  const cp = await rideUntilStopped();
  check("free roam: stopped at a police checkpoint", /Police checkpoint/i.test(cp ?? ""), cp);
  check("…no helmet, licence or registration: 60 coins", /No helmet, rider's licence or registration papers\? That's 60 coins/.test(cp ?? ""), cp);
  check("…the only way on: Pay the fine · 60", /Pay the fine · 60 coins/.test(cp ?? "") && !/Go faster/.test(cp ?? ""));
  await shot("1-papers");
  const before = await coins();
  await clickWhenThere("Pay the fine");
  await wait(2500);
  check("…fined 60", /Fine paid: 60 coins/.test((await scene()) ?? "") && (await coins()) === before - 60, `${await scene()} · ${before - (await coins())}`);
  await clickWhenThere("Go on");
  await wait(1000);

  // ---- A traveller, helped: 15 coins
  await plant("traveller", "Blessing", null);
  const tr = await rideUntilStopped();
  check("free roam: a stranded traveller", /My phone died/.test(tr ?? ""), tr);
  const mid = await coins();
  await clickText("Of course, let me help");
  await wait(3000);
  const thanks = await scene();
  check("…helped: 15 coins for your trouble", /Take these 15 coins/.test(thanks ?? "") && (await coins()) === mid + 15, `${thanks} · ${(await coins()) - mid}`);
  await shot("2-traveller");
  await clickWhenThere("Go on");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (ids.length) await admin.from("road_events").delete().in("user_id", ids);
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
