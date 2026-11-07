// A stop on the way, and cruise stopping at places (owner, 7 Nov 2026: "when using cruise, and I get to a rest or gas
// station or key location. the cruise does not stop" and "When going to the key location I entered in the search box,
// and I needed to rest or eat, the journey plotted was going, no where to resume").
//   1. A tired walker with directions to a far place; the "tired" card's directions to a place to rest: the way to it,
//      with "↩ Back to" the far place.
//   2. There: a card "Then on to" the far place; moving on from the stop, the way to the far place is drawn again.
//   3. Cruising onto a place to rest while tired: cruise goes off by itself. Cruise turned on there: it keeps going.
//   4. Cruising to the end of directions: cruise goes off on arrival.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/stop-on-the-way-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const HOME = { lng: 3.3835, lat: 6.5182 }; // Yaba, ~300 m from a park

async function until(page, fn, arg, ms = 30000) {
  for (let t = 0; t < ms; t += 400) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await wait(400); }
  return false;
}
const directions = (page) => page.evaluate(() => document.querySelector('[aria-label="Directions"]')?.innerText ?? "");
const body = (page) => page.evaluate(() => document.body.innerText);
const cruise = (page) => page.evaluate(() => document.querySelector('button[aria-label^="Cruise"]')?.getAttribute("aria-pressed"));

try {
  const email = `stopway-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ cruise_tokens: 8, home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: HOME.lng, lat: HOME.lat, mode: "walk", energy: 32, updated_at: ago(30) });
  // No road events in this test (one "just happened").
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(page, () => !!document.querySelector('[data-tool="directions"]') && !!window.__lootaRoad?.(), null, 60000);
  await wait(3000);
  // Put the hunter somewhere (the server told first, so the move isn't corrected).
  const jump = async (p) => {
    await admin.from("player_positions").update({ lng: p.lng, lat: p.lat, updated_at: ago(30) }).eq("user_id", id);
    await page.evaluate((q) => window.__lootaJump(q.lng, q.lat), p);
  };

  // 1. Directions to a far place, then the tired card's way to a place to rest
  await page.evaluate(() => document.querySelector('[data-tool="directions"]').click());
  await until(page, () => !!document.querySelector('input[type="search"]'));
  await page.type('input[type="search"]', "Unilag Senate Building");
  await until(page, () => !!document.querySelector('[aria-label="Places found"] [role="option"] button'));
  await page.evaluate(() => document.querySelector('[aria-label="Places found"] [role="option"] button').click());
  const routed = await until(page, () => /^To /m.test(document.querySelector('[aria-label="Directions"]')?.innerText ?? ""));
  const far = (await directions(page)).match(/^To (.+?) ·/m)?.[1] ?? "";
  check("directions to a far place", routed && !!far, far);
  const offered = await until(page, () => !!document.querySelector('button[aria-label^="Directions to"]'), null, 40000);
  const stopName = await page.evaluate(() => document.querySelector('button[aria-label^="Directions to"]')?.getAttribute("aria-label")?.replace("Directions to ", "") ?? "");
  check("tired: a card with the way to a place to rest", offered && !!stopName, stopName);
  await page.evaluate(() => document.querySelector('button[aria-label^="Directions to"]').click());
  const toStop = await until(page, (n) => (document.querySelector('[aria-label="Directions"]')?.innerText ?? "").includes(`To ${n}`), stopName);
  const card = await directions(page);
  check("…the way to it, with ↩ Back to the far place", toStop && card.includes(`↩ Back to ${far}`), card.replace(/\n/g, " | ").slice(0, 200));
  await page.screenshot({ path: `${OUT}/stop-way-1-detour.png` });

  // 2. At the stop, then moving on
  const { data: near } = await admin.rpc("places_near", { p_kinds: ["rest", "eat"], p_lng: HOME.lng, p_lat: HOME.lat, p_limit: 60 });
  const stop = (near ?? []).filter((p) => p.name === stopName).sort((a, b) => a.metres - b.metres)[0];
  if (!stop) throw new Error(`stop ${stopName} not found near home`);
  const at = { lng: stop.street_lng ?? stop.lng, lat: stop.street_lat ?? stop.lat };
  await jump(at);
  const there = await until(page, (n) => document.body.innerText.includes(`Then on to ${n}`), far, 30000);
  check("at the stop: a card 'Then on to' the far place", there, (await body(page)).match(/Then on to [^\n]+/)?.[0] ?? "");
  await page.screenshot({ path: `${OUT}/stop-way-2-there.png` });

  // 3. Cruise turned on at the stop keeps going; cruising back onto it while tired stops
  await page.evaluate(() => document.querySelector('button[aria-label^="Cruise"]')?.click());
  await wait(2500);
  check("cruise turned on at the place to rest: it keeps going", (await cruise(page)) === "true", await cruise(page));
  await page.evaluate(() => { const b = document.querySelector('button[aria-label^="Cruise"]'); if (b?.getAttribute("aria-pressed") === "true") b.click(); }); // off (unless a dead end already stopped it)
  await wait(800);
  await jump(HOME);
  const back = await until(page, (n) => (document.querySelector('[aria-label="Directions"]')?.innerText ?? "").includes(`To ${n}`), far, 30000);
  check("moving on from the stop: the way to the far place is drawn again", back, (await directions(page)).split("\n")[0]);
  await page.screenshot({ path: `${OUT}/stop-way-3-resumed.png` });
  await wait(6000); // the roads around here loaded
  // Cruising along the way on (the road beside the start can end in a dead end), then onto the place to rest
  const ahead = await page.evaluate(() => {
    const d = window.__lootaMap.getSource("route")?.serialize?.().data;
    const cs = d?.geometry?.coordinates ?? [];
    let m = 0;
    for (let i = 1; i < cs.length; i++) {
      m += Math.hypot((cs[i][0] - cs[i - 1][0]) * 110400, (cs[i][1] - cs[i - 1][1]) * 110574);
      if (m > 400) return { lng: cs[i][0], lat: cs[i][1] };
    }
    return null;
  });
  if (ahead) await jump(ahead);
  await wait(5000);
  await page.evaluate(() => document.querySelector('button[aria-label^="Cruise"]')?.click());
  await wait(300);
  const on = await cruise(page);
  if (on !== "true") console.log("cruise didn't start:", JSON.stringify((await body(page)).match(/[^\n]*(ruise|token|road ends)[^\n]*/g)));
  await jump(at);
  const stopped = await until(page, () => document.querySelector('button[aria-label^="Cruise"]')?.getAttribute("aria-pressed") === "false", null, 8000);
  check("cruising onto a place to rest while tired: cruise goes off", on === "true" && stopped, `${on} → ${await cruise(page)}`);
  const why = (await body(page)).split(String.fromCharCode(10)).find((l) => /cruise off|road ends/i.test(l)) ?? "";
  check("…and says why", /cruise off, so you can stop here/.test(why), why);

  // 4. Cruise to the end of directions
  await jump(HOME);
  await wait(3000);
  await page.evaluate(() => document.querySelector('[data-tool="directions"]').click());
  await until(page, () => !!document.querySelector('input[type="search"]'));
  await page.evaluate(() => { const i = document.querySelector('input[type="search"]'); i.value = ""; });
  await page.type('input[type="search"]', "Unilag Senate Building");
  await until(page, () => !!document.querySelector('[aria-label="Places found"] [role="option"] button'));
  await page.evaluate(() => document.querySelector('[aria-label="Places found"] [role="option"] button').click());
  await until(page, () => /^To /m.test(document.querySelector('[aria-label="Directions"]')?.innerText ?? ""));
  const end = await page.evaluate(() => {
    const src = window.__lootaMap.getSource("route")?.serialize?.().data;
    const coords = src?.geometry?.coordinates ?? src?.features?.[0]?.geometry?.coordinates;
    return coords ? coords[coords.length - 1] : null;
  });
  const start = await page.evaluate(() => {
    const d = window.__lootaMap.getSource("route")?.serialize?.().data;
    const cs = d?.geometry?.coordinates ?? [];
    let m = 0;
    for (let i = 1; i < cs.length; i++) {
      m += Math.hypot((cs[i][0] - cs[i - 1][0]) * 110400, (cs[i][1] - cs[i - 1][1]) * 110574);
      if (m > 400) return { lng: cs[i][0], lat: cs[i][1] };
    }
    return null;
  });
  if (start) await jump(start); // on the way (the road beside home can end in a dead end)
  await wait(5000);
  await page.evaluate(() => document.querySelector('button[aria-label^="Cruise"]')?.click());
  await wait(300);
  const on2 = await cruise(page);
  if (end) await jump({ lng: end[0], lat: end[1] });
  const arrived = await until(page, () => /You've arrived at/.test(document.body.innerText), null, 15000);
  check("cruising to the end of directions: arrived, and cruise goes off", !!end && on2 === "true" && arrived && (await cruise(page)) === "false", `end ${!!end}, ${on2} → ${await cruise(page)}, arrived ${arrived}`);
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
  process.exit(fails ? 1 : 0);
}
