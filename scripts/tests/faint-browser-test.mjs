// Fainting at 0 energy (owner, 27 Oct 2026: "the logic to make the user faint when on 0 health is no longer working,
// the avatar just looks like falling, and then continue moving"), on a phone: a hunter walking with 3 energy left
// collapses, stays down (holding ↑ does nothing), the server records the faint, and the ambulance is called. Twice:
// with the server's count agreeing, and with the server thinking there are 6 left when the device reached 0 (it
// measures straight lines between saves, so after winding streets it counts less used): the collapse still stands.
// The test players (and their hospital visits) are deleted.
//   SHOTS=<folder> node scripts/tests/faint-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const yaba = { lng: 3.3787, lat: 6.5186 };

async function scenario(tag, serverAhead) {
  const email = `faint-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 3, updated_at: new Date().toISOString() });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  // The device's energy, read as it goes; when it shows 0 the server is made to think there's more left.
  let shown = 100;
  let bumped = false;
  if (serverAhead) {
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      if (!bumped && shown === 0 && /\/rpc\/save_position/.test(req.url())) {
        bumped = true;
        await admin.from("player_positions").update({ energy: serverAhead }).eq("user_id", id);
      }
      void req.continue();
    });
  }
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(12000);
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());

  // Walk until the energy runs out, and keep holding ↑ a while after.
  const said = new Set();
  await page.keyboard.down("ArrowUp");
  let downAt = null;
  for (let i = 0; i < 160; i++) {
    await wait(250);
    const s = await page.evaluate(() => ({
      text: document.body.innerText,
      energy: Number(/Energy (\d+)/.exec(document.querySelector('[aria-label^="Energy "]')?.getAttribute("aria-label") ?? "")?.[1] ?? 100),
    }));
    shown = s.energy;
    for (const line of s.text.split("\n")) if (/faint|collapse|exhausted|ambulance|paramedic/i.test(line)) said.add(line.trim());
    if (!downAt && [...said].some((l) => /You fainted/.test(l))) downAt = await page.evaluate(() => window.__lootaRoad?.() ?? null);
  }
  const end = await page.evaluate(() => window.__lootaRoad?.() ?? null);
  await page.keyboard.up("ArrowUp");
  console.log(`[${tag}] said:`, [...said].join(" | "));
  if (serverAhead) check(`[${tag}] the server thought there were ${serverAhead} left when the device reached 0`, bumped);
  check(`[${tag}] walking on 3 energy: fainted`, !!downAt, JSON.stringify(downAt));
  check(`[${tag}] …and stayed down (no walking on, ↑ still held)`, downAt && end && metres(downAt, end) < 3, downAt && end ? `${metres(downAt, end).toFixed(1)} m after` : "");
  check(`[${tag}] …not stood back up ("about to collapse")`, ![...said].some((l) => /about to collapse/.test(l)));
  const { data: pos } = await admin.from("player_positions").select("energy, fainted_at").eq("user_id", id).single();
  check(`[${tag}] the server has the faint`, !!pos.fainted_at && pos.energy <= 0, JSON.stringify(pos));
  const { data: visit } = await admin.from("hospital_visits").select("hospital, left_at").eq("user_id", id).maybeSingle();
  check(`[${tag}] …and the ambulance is called`, !!visit && !visit.left_at, JSON.stringify(visit));
  await page.screenshot({ path: `${OUT}/faint-${tag}.png` });
  check(`[${tag}] no page errors`, problems.length === 0, problems.join(" / "));
  await page.close();
}

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  await scenario("agree", 0);
  await scenario("server-ahead", 6);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    await admin.from("hospital_visits").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
