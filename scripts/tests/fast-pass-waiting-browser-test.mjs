// A Fast Pass at the bus stop (owner, 26 Oct 2026: "I am at the bus stop and I cannot use the fast pass"), on a phone.
// With no ride booked, using it says how (and keeps it); booked on a crowded city bus 4 minutes away: the trip banner
// has a Fast Pass button; tapped: no wait, no scramble, the bus leaves now with the hunter aboard, and one use is gone;
// the button is gone too. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/fast-pass-waiting-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  // Two bus stops near Yaba, 1–4 km apart.
  const { data: stops } = await admin.from("transit_stops").select("id, name, lng, lat").eq("kind", "bus").gte("lng", 3.37).lte("lng", 3.40).gte("lat", 6.50).lte("lat", 6.53).limit(400);
  const from = stops[0];
  const k = (a, b) => Math.hypot((a.lng - b.lng) * 110000, (a.lat - b.lat) * 110574);
  const to = stops.find((s) => k(s, from) > 1000 && k(s, from) < 4000);
  const email = `fastpass-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: from.lng, home_lat: from.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 200, p_kind: "admin", p_reason: "Fast Pass test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: from.lng, lat: from.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  const { data: relic, error: rErr } = await admin.from("player_relics").insert({ user_id: id, relic: "fast_pass", charges: 2, expires_at: soon(86400) }).select("id").single();
  if (rErr) throw rErr;
  const charges = async () => (await admin.from("player_relics").select("charges").eq("id", relic.id).single()).data.charges;

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  // Nothing booked: not yet, and kept.
  const { data: early } = await c.rpc("use_relic", { p_relic: relic.id });
  check("nothing booked: not yet, and the pass is kept", early?.ok === false && early.reason === "not_yet" && (await charges()) === 2, JSON.stringify(early));

  // A crowded city bus, 4 minutes away.
  const { data: booked } = await c.rpc("start_trip", { p_from: from.id, p_to: to.id, p_path: [[from.lng, from.lat], [to.lng, to.lat]], p_fast_pass: false });
  check("a city bus booked", booked?.ok === true, booked?.reason ?? `${from.name} → ${to.name}`);
  const tripId = booked.trip.id;
  const trip = async () => (await admin.from("transit_trips").select("*").eq("id", tripId).single()).data;
  const rideS = (await trip()).ride_s ?? 60;
  await admin.from("transit_trips").update({ rush: "pending", departs_at: soon(240), arrives_at: soon(240 + rideS) }).eq("id", tripId);

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const banner = () => page.evaluate((nl) => document.querySelector('[aria-label="Your trip"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const passButton = () => page.evaluate(() => !!document.querySelector('[aria-label="Your trip"] button[aria-label^="Use a Fast Pass"]'));
  let has = false;
  for (let i = 0; i < 40 && !has; i++) {
    await wait(1000);
    has = await passButton();
  }
  check("waiting for the bus: a Fast Pass button on the trip banner", has, await banner());
  await page.screenshot({ path: `${OUT}/fastpass-1-waiting.png` });
  await page.evaluate(() => document.querySelector('[aria-label="Your trip"] button[aria-label^="Use a Fast Pass"]')?.click());
  let said = "";
  for (let i = 0; i < 10 && !/Fast Pass: no waiting/.test(said); i++) {
    await wait(500);
    said = await page.evaluate(() => document.body.innerText);
  }
  check("tapped: \"Fast Pass: no waiting\"", /Fast Pass: no waiting/.test(said), (said.match(/Fast Pass:[^\n]*/) ?? [""])[0]);
  const t = await trip();
  check("the server: the bus leaves now, the scramble skipped", Date.parse(t.departs_at) <= Date.now() + 2000 && t.fast_pass === true && t.rush === "boarded", `${t.departs_at} ${t.rush}`);
  check("…and one use of the pass is gone", (await charges()) === 1);
  await wait(3000);
  const now = await banner();
  check("on the bus: no more waiting, no Fast Pass button", !!now && !/leaves in|crowd/i.test(now) && !(await passButton()), now);
  check("no bus rush on screen", !(await page.evaluate(() => !!document.querySelector('[aria-label="Bus rush"]'))));
  await page.screenshot({ path: `${OUT}/fastpass-2-aboard.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.from("player_relics").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
