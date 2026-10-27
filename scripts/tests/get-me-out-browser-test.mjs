// "Get me out" (owner, 27 Oct 2026: "we need an everlasting solution to this, because it will be disastrous when we go
// live"), on a phone: a hunter put down where no road is near enough to stand on (by Lagos Lagoon, the nearest road
// ~1.4 km off) is offered "Going nowhere? Get me out"; it puts them on a road that leads somewhere and the server keeps
// it. Asked again from the help panel on a good road, it says the road leads out. The server's limits: no more than
// 2 km, once every 10 minutes. (Shut in behind a fence is airside-browser-test.mjs.) The test player is deleted.
//   SHOTS=<folder> node scripts/tests/get-me-out-browser-test.mjs
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
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const spot = { lng: 3.42, lat: 6.545 }; // by Lagos Lagoon: no road within 1.4 km

try {
  const email = `getout-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: soon(3600), created_at: soon(3600) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });

  const offer = () => page.evaluate(() => document.querySelector('[aria-label="Stuck"]')?.innerText ?? "");
  let shown = "";
  for (let i = 0; i < 40 && !shown; i++) {
    await wait(1000);
    shown = await offer();
  }
  check("no road near enough to stand on: offered a way out", /Going nowhere\?/.test(shown) && /Get me out/.test(shown), shown);
  await page.evaluate(() => document.querySelector('[aria-label="Hunt is live"] button[aria-label="Not now"]')?.click());
  await page.screenshot({ path: `${OUT}/get-me-out-1-offer.png` });

  const before = await page.evaluate(() => window.__lootaRoad?.() ?? null);
  check("…with no road to stand on", before === null, JSON.stringify(before));
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Stuck"] button')].find((b) => /Get me out/.test(b.textContent ?? ""))?.click());
  let after = before;
  for (let i = 0; i < 15 && !(after && after.pocket === 0); i++) {
    await wait(1000);
    after = await page.evaluate(() => window.__lootaRoad?.() ?? null);
  }
  const moved = after ? metres(after, spot) : -1;
  check("Get me out: on a road that leads somewhere", after?.pocket === 0, JSON.stringify(after));
  check("…a hop under 2 km", moved > 30 && moved <= 2000, `${Math.round(moved)} m`);
  check("…the offer gone", !(await offer()));
  await wait(3000);
  const { data: kept } = await admin.from("player_positions").select("lng, lat, freed_at").eq("user_id", id).single();
  check("…and the server keeps it", after && metres(kept, after) < 40 && !!kept.freed_at, `${Math.round(after ? metres(kept, after) : -1)} m`);
  await page.screenshot({ path: `${OUT}/get-me-out-2-out.png` });

  // From the help panel, on a road that does lead out.
  await page.evaluate(() => document.querySelector('[aria-label="Help"]')?.click());
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Stuck\? Get me out/.test(b.textContent ?? ""))?.click());
  await wait(1500);
  const said = await page.evaluate(() => document.body.innerText);
  check("asked again on a good road: told it leads out (no hop)", /Your road does lead out/.test(said));

  // The server's limits.
  const far = (await c.rpc("free_me", { p_lng: kept.lng + 0.03, p_lat: kept.lat })).data;
  check("server: no more than 2 km", far?.ok === false && far.reason === "far", JSON.stringify(far));
  const again = (await c.rpc("free_me", { p_lng: kept.lng + 0.005, p_lat: kept.lat })).data;
  check("server: once every 10 minutes", again?.ok === false && again.reason === "wait" && !!again.next, JSON.stringify(again));
  const { data: log } = await admin.from("unstuck_log").select("from_lng, from_lat, moved_m").eq("user_id", id);
  check("server: the stuck spot is logged (to fix the map there)", log?.length === 1 && metres({ lng: log[0].from_lng, lat: log[0].from_lat }, spot) < 40, JSON.stringify(log));
  // Three a day at most: two more uses (as if 10 minutes apart), then no.
  for (const k of [1, 2]) {
    await admin.from("player_positions").update({ freed_at: ago(700) }).eq("user_id", id);
    const ok = (await c.rpc("free_me", { p_lng: kept.lng + 0.001 * k, p_lat: kept.lat })).data;
    if (!ok?.ok) check(`server: use ${k + 1} of 3`, false, JSON.stringify(ok));
  }
  await admin.from("player_positions").update({ freed_at: ago(700) }).eq("user_id", id);
  const fourth = (await c.rpc("free_me", { p_lng: kept.lng + 0.004, p_lat: kept.lat })).data;
  check("server: 3 a day at most", fourth?.ok === false && fourth.reason === "today", JSON.stringify(fourth));
  const anon = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).rpc("free_me", { p_lng: 0, p_lat: 0 });
  check("server: signed-in players only", !!anon.error);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
