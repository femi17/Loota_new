// On the ward from the moment the ambulance arrives (owner, 2 Nov 2026: "immediately the ambulance stops there, the
// scene should appear, you lying on the bed receiving treatments"). On a phone, a hunter whose ambulance has just
// reached the hospital: the ward opens at once with the nurse at the bedside (no leaving, the time left, questions);
// when the treatment is over, the nurse's goodbye ("Ah, you're up!"), then Bye closes it. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/hospital-ward-browser-test.mjs
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
const box = { lng0: 3.37, lng1: 3.39, lat0: 6.51, lat1: 6.53 }; // Yaba

try {
  const hospital = (await admin.from("places").select("name, lng, lat").eq("kind", "hospital").gte("lng", box.lng0).lte("lng", box.lng1).gte("lat", box.lat0).lte("lat", box.lat1).limit(1)).data[0];
  const email = `ward-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: hospital.lng, home_lat: hospital.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: hospital.lng, lat: hospital.lat, mode: "walk", energy: 0, fainted_at: ago(200), updated_at: ago(30) });
  // The ambulance reached the hospital a moment ago; out in 45 s.
  await admin.from("hospital_visits").upsert({
    user_id: id, hospital: hospital.name, lng: hospital.lng, lat: hospital.lat, bill: 50,
    approach: [[hospital.lng + 0.01, hospital.lat], [hospital.lng + 0.005, hospital.lat]],
    route: [[hospital.lng + 0.005, hospital.lat], [hospital.lng, hospital.lat]],
    called_at: ago(200), picked_at: ago(120), arrives_at: ago(3), discharged_at: soon(45), left_at: null,
  });
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
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const clickText = (x) => page.evaluate((s) => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((e) => e.textContent?.trim().startsWith(s));
    b?.click();
    return !!b;
  }, x);
  const until = async (fn, ms) => { for (let t = 0; t < ms; t += 500) { const v = await fn(); if (v) return v; await wait(500); } return null; };
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });

  // 1. On the ward at once, being treated
  const ward = await until(async () => { const t = await text(`[role="dialog"][aria-label="At ${hospital.name}"]`); return /strength back/.test(t ?? "") && t; }, 45000); // (typed out)
  check(`the ambulance has arrived: on the ward at ${hospital.name}`, /Lie still/.test(ward ?? "") && /drip/.test(ward ?? ""), ward);
  check("…being treated, the time left showing", /Back on your feet in \d+:\d\d/.test(ward ?? ""), ward);
  check("…and no leaving yet", !(await page.$('[role="dialog"] button[aria-label="Leave"]')));
  await wait(2500);
  await page.screenshot({ path: `${OUT}/ward-1-treated.png` });
  await until(() => clickText("How much is this?"), 10000);
  const bill = await until(async () => { const t = await text('[role="dialog"]'); return /50 coins, and it's already paid/.test(t ?? "") && t; }, 10000);
  check("…the nurse answers while you lie there", !!bill, bill ?? (await text('[role="dialog"]')));

  // 2. Treated: the goodbye
  const bye = await until(() => text(`[role="dialog"][aria-label="Leaving ${hospital.name}"]`), 80000);
  check("treated: up, and the nurse's goodbye", /Ah, you're up!/.test(bye ?? ""), bye);
  await wait(2500);
  await page.screenshot({ path: `${OUT}/ward-2-up.png` });
  const { data: v } = await admin.from("hospital_visits").select("left_at").eq("user_id", id).maybeSingle();
  check("…discharged on the server", !!v?.left_at, JSON.stringify(v));
  await until(() => clickText("Thank you, nurse"), 10000);
  await until(() => clickText("Bye"), 10000);
  const closed = await until(async () => (await page.$('[role="dialog"]')) === null, 8000);
  check("…Bye closes the ward", !!closed);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("hospital_visits").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
