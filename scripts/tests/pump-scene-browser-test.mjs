// The vulcanizer as a scene on the map (phone): riding a bicycle with soft tyres to a vulcanizer, Pump opens the
// place (the vulcanizer, the compressor, your bicycle on the stand); "Go ahead" starts the job and the work bar runs
// for about 8 seconds before the tyres are full (5 coins, charged at the end). A flat at a petrol station: patched and
// pumped (about 20 seconds, 20 coins). "No thanks" walks out without paying. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/pump-scene-browser-test.mjs
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
const box = { lng0: 3.37, lng1: 3.39, lat0: 6.49, lat1: 6.53 }; // Yaba
const placeOf = async (kind) =>
  (await admin.from("places").select("name, lng, lat").eq("kind", kind).gte("lng", box.lng0).lte("lng", box.lng1).gte("lat", box.lat0).lte("lat", box.lat1).limit(1)).data[0];

try {
  const vulcanizer = await placeOf("tyres");
  const station = await placeOf("fuel");
  const email = `pump-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: vulcanizer.lng, home_lat: vulcanizer.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 200, p_kind: "admin", p_reason: "Pump scene test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: vulcanizer.lng, lat: vulcanizer.lat, mode: "bicycle", energy: 90, updated_at: ago(30) });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 30, engine: 100, lng: vulcanizer.lng, lat: vulcanizer.lat, in_use: true, light: true });

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
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const shot = (name) => page.screenshot({ path: `${OUT}/pump-${name}.png` });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const tyre = async () => (await admin.from("player_vehicles").select("tyre").eq("user_id", id).eq("kind", "bicycle").single()).data.tyre;
  const clickText = (x) => page.evaluate((s) => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((e) => e.textContent?.trim().startsWith(s));
    b?.click();
    return !!b;
  }, x);
  const clickWhenThere = async (x) => {
    for (let i = 0; i < 20; i++) {
      if (await clickText(x)) return true;
      await wait(500);
    }
    return false;
  };
  const open = async () => {
    await page.goto("about:blank");
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };
  const tapHere = (x) => page.evaluate((s) => {
    const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.includes(s));
    b?.click();
    return !!b;
  }, x);
  const until = async (sel, re, tries = 40) => {
    let t = null;
    for (let i = 0; i < tries && !re.test(t ?? ""); i++) {
      await wait(500);
      t = await text(sel);
    }
    return t;
  };

  // ---- Soft tyres at the vulcanizer
  await open();
  check("riding up to the vulcanizer: a Pump button", await tapHere("Pump · 5"));
  const scene = await until(`[role="dialog"][aria-label="Tyres at ${vulcanizer.name}"]`, /about 8 seconds/);
  check(`Pump opens the vulcanizer at ${vulcanizer.name}`, /Your tyres are soft o.*5 coins, about 8 seconds/.test(scene ?? ""), scene);
  await shot("1-greet");
  const before = await coins();
  check("…go ahead", await clickWhenThere("Go ahead · 5 coins"));
  await wait(2500);
  const working = await text('[role="dialog"]');
  check("the work bar runs, nothing charged yet", /Ready in 0:0[3-7]/.test(working ?? "") && (await coins()) === before && (await tyre()) < 95, `${working} · ${before - (await coins())} · ${await tyre()}`);
  await shot("2-working");
  const done = await until('[role="dialog"]', /Hard as rock/, 30);
  check("…about 8 seconds later: hard as rock", /Hard as rock/.test(done ?? ""), done);
  check("…the tyres at 100, 5 coins", (await tyre()) === 100 && (await coins()) === before - 5, `${await tyre()} · ${before - (await coins())}`);
  await shot("3-done");
  await clickWhenThere("Thank you!");
  await wait(1500);
  check("…and walks out", (await page.$('[role="dialog"]')) === null);

  // ---- A flat at the petrol station: patched and pumped
  await admin.from("player_vehicles").update({ tyre: 0, lng: station.lng, lat: station.lat }).eq("user_id", id).eq("kind", "bicycle");
  await admin.from("player_positions").update({ lng: station.lng, lat: station.lat, updated_at: ago(30) }).eq("user_id", id);
  await open();
  check("a flat at the petrol station: a Fix flat button", await tapHere("Fix flat · 20"));
  const flat = await until('[role="dialog"]', /about 20 seconds/);
  check("…the vulcanizer: patch and pump, 20 coins, about 20 seconds", /patch the tube and pump it: 20 coins, about 20 seconds/.test(flat ?? ""), flat);
  // "No thanks" first: nothing paid, and out
  const c0 = await coins();
  await clickWhenThere("No thanks");
  await clickWhenThere("Bye");
  await wait(1500);
  check("No thanks: out, nothing paid, still flat", (await page.$('[role="dialog"]')) === null && (await coins()) === c0 && (await tyre()) === 0);
  await tapHere("Fix flat · 20");
  await clickWhenThere("Go ahead · 20 coins");
  await wait(10000);
  const mid = await text('[role="dialog"]');
  check("…halfway: still working", /Ready in 0:(0\d|1\d)/.test(mid ?? "") && (await tyre()) === 0, mid);
  const patched = await until('[role="dialog"]', /patch is strong/, 30);
  check("…done: the patch strong, the tyre at 100, 20 coins", /patch is strong/.test(patched ?? "") && (await tyre()) === 100 && (await coins()) === c0 - 20, `${await tyre()} · ${c0 - (await coins())}`);
  await shot("4-patched");
  await clickWhenThere("Thank you!");
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
