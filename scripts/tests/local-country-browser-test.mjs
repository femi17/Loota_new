// The country you're in (owner, 27 Oct 2026: "it is not only focused on Nigeria but the country which you find
// yourself"), on a phone: in Calgary, on a bicycle with soft tyres at a Shell station, the radio's dial starts with
// Canada's stations (one of them plays), then Nigeria's under their own heading; the tyre pump's keeper has a name from
// there and no pidgin. In Lagos it's as it was: Nigeria's stations only, a Nigerian keeper talking as before. The test players and bicycles
// are deleted.
//   SHOTS=<folder> node scripts/tests/local-country-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const NIGERIAN = /Baba Sule|Emeka|Kunle|Alhaji Musa|Chinedu|wahala|I dey|Ehen/;

async function open(tag, at) {
  const email = `${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString(), coins: 200 }).eq("id", id);
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 60, engine: 100, lng: at.lng, lat: at.lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "bicycle", energy: 100, updated_at: new Date().toISOString() });
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
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(15000);
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());
  return { page, problems };
}

const dial = (page) =>
  page.evaluate(() => {
    const list = document.querySelector('[aria-label="Stations"]');
    return { names: [...(list?.querySelectorAll("li button .font-bold") ?? [])].map((e) => e.textContent ?? ""), heading: /Nigerian stations/.test(list?.textContent ?? "") };
  });
const status = (page) => page.evaluate(() => document.querySelector('[aria-label="Radio status"]')?.textContent ?? "");

async function pumpScene(page) {
  let pump = false;
  for (let i = 0; i < 20 && !pump; i++) {
    await wait(1000);
    pump = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Pump/.test(x.textContent ?? ""));
      b?.click();
      return !!b;
    });
  }
  await wait(6000);
  return page.evaluate(() => document.body.innerText);
}

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });

  // ---- Calgary
  const a = await open("calgary", { lng: -114.004319, lat: 51.134688 }); // a Shell station
  await a.page.evaluate(() => document.querySelector('[data-tool="radio"]')?.click());
  let d = await dial(a.page);
  for (let i = 0; i < 15 && !d.heading; i++) {
    await wait(1000);
    d = await dial(a.page);
  }
  check("Calgary: the dial starts with stations from there", d.heading && d.names[0] !== "Cool FM 96.9", d.names.slice(0, 4).join(" · "));
  check("…then Nigeria's, under their own heading", d.heading && d.names.includes("Cool FM 96.9"));
  let live = "";
  for (let k = 0; k < 3 && !/Live/.test(live); k++) {
    await a.page.evaluate((i) => document.querySelectorAll('[aria-label="Stations"] li button')[i]?.click(), k);
    for (let i = 0; i < 20 && !/Live/.test(live); i++) {
      await wait(1000);
      live = await status(a.page);
    }
  }
  check("…and one of Canada's plays", /Live/.test(live), live);
  await a.page.screenshot({ path: `${OUT}/local-1-radio.png` });
  await a.page.evaluate(() => document.querySelector('[aria-label="Turn the radio off"]')?.click());
  await a.page.evaluate(() => document.querySelector('[aria-label="Loota Radio"] button[aria-label="Close"]')?.click());
  const scene = await pumpScene(a.page);
  const line = scene.split("\n").find((l) => /Your tyres are soft/.test(l)) ?? "";
  check("…the tyre pump's keeper: a name from there", /\b(Mike|Sarah|Dave|Jen|Tom|Lisa|Chris|Amy)\b/.test(scene) && /Your tyres are soft/.test(scene), line);
  check("…and no pidgin", !NIGERIAN.test(scene) && !/soft o\./.test(scene));
  await a.page.screenshot({ path: `${OUT}/local-2-pump.png` });
  check("no page errors", a.problems.length === 0, a.problems.join(" / "));
  await a.page.close();

  // ---- Lagos
  const b = await open("lagos", { lng: 3.385347, lat: 6.519143 }); // a petrol station in Yaba
  await b.page.evaluate(() => document.querySelector('[data-tool="radio"]')?.click());
  await wait(4000);
  const n = await dial(b.page);
  check("Lagos: Nigeria's stations only, as before", !n.heading && n.names[0] === "Cool FM 96.9" && n.names.length === 10, n.names.slice(0, 3).join(" · "));
  await b.page.evaluate(() => document.querySelector('[aria-label="Loota Radio"] button[aria-label="Close"]')?.click());
  const home = await pumpScene(b.page);
  const homeLine = home.split("\n").find((l) => /Your tyres are soft/.test(l)) ?? "";
  check("…the pump's keeper: a Nigerian name and Nigerian talk, as before", /Chidi|Musa|Segun|Ibrahim|Emeka|Yusuf|Sola|Baba Sule|Kunle|Alhaji Musa|Chinedu/.test(home) && /soft o\./.test(home), homeLine);
  check("no page errors", b.problems.length === 0, b.problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
