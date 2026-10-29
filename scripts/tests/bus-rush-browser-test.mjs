// The bus rush (phone): a crowded city bus → the crowd at the stop → RUSH! strip → all wrong (usually: the bus fills
// up and leaves, the next one comes) → all right (sure to get on) → the ride. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/bus-rush-browser-test.mjs
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
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

/** The answer to a rush question, worked out from it. */
function answerOf(q) {
  let m = /^(\d+) \+ (\d+)$/.exec(q);
  if (m) return +m[1] + +m[2];
  m = /^(\d+) − (\d+)$/.exec(q);
  if (m) return +m[1] - +m[2];
  m = /^(\d+) × (\d+)$/.exec(q);
  if (m) return +m[1] * +m[2];
  m = /^Half of (\d+)$/.exec(q);
  if (m) return +m[1] / 2;
  m = /^(\d+), (\d+), (\d+), (\d+), \?$/.exec(q);
  if (m) return +m[4] + (+m[4] - +m[3]);
  return null;
}

try {
  // Two bus stops near Yaba, 1–4 km apart.
  const { data: stops } = await admin.from("transit_stops").select("id, name, lng, lat").eq("kind", "bus").gte("lng", 3.37).lte("lng", 3.40).gte("lat", 6.50).lte("lat", 6.53).limit(400);
  const from = stops[0];
  const k = (a, b) => Math.hypot((a.lng - b.lng) * 110000, (a.lat - b.lat) * 110574);
  const to = stops.find((s) => k(s, from) > 1000 && k(s, from) < 4000);
  const email = `rush-b-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: from.lng, home_lat: from.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 200, p_kind: "admin", p_reason: "Bus rush test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: from.lng, lat: from.lat, mode: "walk", energy: 90, updated_at: ago(30) });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const { data: booked } = await c.rpc("start_trip", { p_from: from.id, p_to: to.id, p_path: [[from.lng, from.lat], [to.lng, to.lat]], p_fast_pass: false });
  check("a city bus booked", booked?.ok === true, booked?.reason ?? `${from.name} → ${to.name}, rush: ${booked?.trip?.rush ?? "none (daytime)"}`);
  const tripId = booked.trip.id;
  // Whatever the hour: a crowded bus, pulling in 12 seconds from now.
  const trip = async () => (await admin.from("transit_trips").select("*").eq("id", tripId).single()).data;
  const rideS = (await trip()).ride_s ?? 60;
  const busIn = (s) => admin.from("transit_trips").update({ rush: "pending", departs_at: soon(s), arrives_at: soon(s + rideS) }).eq("id", tripId);
  await busIn(22);

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const text = (sel) => page.evaluate(async (s, nl) => {
    // On a phone the trip folds to an icon after a moment: tap it open first.
    const pill = document.querySelector('[data-pill="ride"]');
    if (s === '[aria-label="Your trip"]' && pill && pill.getAttribute("aria-expanded") !== "true") {
      pill.click();
      await new Promise((r) => setTimeout(r, 400));
    }
    return document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null;
  }, sel, NL);
  const strip = () => text('[aria-label="Bus rush"]');
  const shot = (name) => page.screenshot({ path: `${OUT}/rush-${name}.png` });
  /** Answer every question: right (true) or wrong (false). Returns how many were asked. */
  async function answerAll(right) {
    let asked = 0;
    for (let n = 0; n < 5; n++) {
      const q = await page.evaluate(() => {
        const g = document.querySelector('[aria-label="Bus rush"]');
        const p = g?.querySelector("p.font-display");
        const buttons = [...(g?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
        return p ? { q: p.textContent, choices: buttons } : null;
      });
      if (!q) break;
      asked++;
      const expected = answerOf(q.q);
      let pick = q.choices.findIndex((x) => Number(x) === expected);
      if (!right) pick = (pick + 1) % 3;
      await page.evaluate((i) => [...document.querySelector('[aria-label="Bus rush"]').querySelectorAll("button")][i]?.click(), pick);
      await wait(700);
      if (n === 1) await shot(right ? "3-pushing" : "1-pushing");
    }
    return asked;
  }

  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(12000);
  const waiting = await text('[aria-label="Your trip"]');
  check("waiting at the stop: a crowd is waiting, get ready to push", /A crowd is waiting/.test(waiting ?? ""), waiting);
  await shot("0-crowd");
  for (let i = 0; i < 20 && !(await strip()); i++) await wait(1000);
  const first = await strip();
  check("the bus pulls in: RUSH!", /RUSH! Push through the crowd/.test(first ?? ""), first);

  // ---- All wrong: usually the bus fills up and leaves without you
  const askedWrong = await answerAll(false);
  check("five quick questions", askedWrong === 5, String(askedWrong));
  await wait(2500);
  const after = await strip();
  const t1 = await trip();
  if (t1.rush === "boarded") {
    console.log("      (all wrong, but lucky: the 10% chance got on; the miss is skipped)");
  } else {
    check("all wrong: the bus is full, wait for the next one", /Bus full!/.test(after ?? "") && t1.rush_tries === 1 && Date.parse(t1.departs_at) > Date.now() + 20000, after);
    await shot("2-full");
    // ---- The next bus: all right, sure to get on
    // Not 1:45 of waiting: the next bus comes sooner, and the page (reloaded) hears of it.
    await wait(4500);
    await page.goto("about:blank");
    await busIn(20);
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    for (let i = 0; i < 40 && !/RUSH!/.test((await strip()) ?? ""); i++) await wait(1000);
    check("the next bus: another rush", /RUSH!/.test((await strip()) ?? ""));
    await answerAll(true);
    await wait(2500);
  }
  const t2 = await trip();
  const done = await strip();
  check("all right: you squeeze in and the bus leaves with you", t2.rush === "boarded" && (/You're on!/.test(done ?? "") || /lucky/.test("")), done);
  await shot("4-on");
  await wait(4000);
  const riding = await text('[aria-label="Your trip"]');
  check("riding: you get off at the stop", /you get off at|Next stop/.test(riding ?? ""), riding);
  const { data: rushes } = await admin.from("bus_rushes").select("score, chance, outcome").eq("trip_id", tripId).order("id");
  console.log("      rushes:", JSON.stringify(rushes));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
