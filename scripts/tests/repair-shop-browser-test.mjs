// The repair shop in the browser (phone): a broken bicycle → "Repair shop nearby" in the vehicle panel → the shop on
// the map → "Go in" → the scene: greeting, "Please repair my bicycle", the price and the wait, "That's OK", the
// keeper at work → back when it's ready → "Thank you!" → the bicycle is mended. The test player is deleted.
//   SHOTS=<folder> [KEEPER="Iya Femi"] node scripts/tests/repair-shop-browser-test.mjs
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

const yaba = { lng: 3.3787, lat: 6.5186 };
try {
  const email = `repair-b-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 100, p_kind: "admin", p_reason: "Repair shop test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 10, engine: 100, lng: yaba.lng, lat: yaba.lat, in_use: false, broken_at: ago(300) });

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
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll("button")].find((y) => (y.textContent?.includes(x) || y.getAttribute("aria-label")?.includes(x)) && !y.disabled); b?.click(); return !!b; }, t);
  const shot = (name) => page.screenshot({ path: `${OUT}/repair-${name}.png` });
  const open = async () => {
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };
  const scene = () => text('[role="dialog"]');
  const job = async () => (await admin.from("repair_jobs").select("*").eq("user_id", id).is("closed_at", null).maybeSingle()).data;

  // ---- Out of hospital (it collapsed on the bicycle): a repair shop near the hospital, and the way there
  const hospital = { lng: yaba.lng + 0.004, lat: yaba.lat };
  await admin.from("hospital_visits").upsert({
    user_id: id, hospital: "Test Hospital", lng: hospital.lng, lat: hospital.lat, bill: 0,
    called_at: ago(120), picked_at: ago(110), arrives_at: ago(100), discharged_at: ago(5), left_at: null,
  });
  await open();
  // You wake on the ward (the nurse's scene, on the map): walk out to the street.
  await clickText("Walk out");
  await wait(2500);
  const fromHospital = await job();
  const said = await page.evaluate(() => document.body.innerText);
  check("discharged: a repair shop near the hospital is found by itself", !!fromHospital && /Discharged|needs a repair|blue line/.test(said), fromHospital ? `${fromHospital.shop}` : "none");
  await shot("0-from-hospital");

  // ---- The vehicle panel: Repair shop nearby
  await page.evaluate(() => document.querySelector('[data-tool="travel"]')?.click());
  await wait(1000);
  check("the broken bicycle offers a repair shop (40) and a call-out (60)", /Repair shop nearby · 40/.test((await text('[aria-label="Vehicles"]')) ?? "") && /Call a mechanic to you · 60/.test((await text('[aria-label="Vehicles"]')) ?? ""));
  await clickText("Repair shop nearby");
  await wait(5000);
  const j = await job();
  const screen = await page.evaluate(() => document.body.innerText);
  check("a shop is found nearby, and the game names it", !!j && (screen.includes(j.shop) || /needs a repair/.test(screen)), j ? `${j.shop} (${j.keeper})` : "none");
  await shot("1-found");

  // KEEPER="Iya Femi" (say) puts that keeper in the shop, to see them.
  if (process.env.KEEPER) {
    await admin.from("repair_jobs").update({ keeper: process.env.KEEPER, shop: `${process.env.KEEPER} Bicycle Clinic` }).eq("id", j.id);
    Object.assign(j, { keeper: process.env.KEEPER, shop: `${process.env.KEEPER} Bicycle Clinic` });
  }

  // ---- At the shop: Go in (the page is closed first, or its last save would undo the move)
  await page.goto("about:blank");
  await wait(1500);
  await admin.from("player_positions").update({ lng: j.lng, lat: j.lat, updated_at: ago(30) }).eq("user_id", id);
  await open();
  check("at the shop: the Go in button", await clickText("Go in"));
  await wait(3500);
  const greet = await scene();
  check("the keeper greets you", new RegExp(`Hello! Welcome to ${j.shop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(greet ?? ""), greet);
  await shot("2-greet");

  await clickText("Please repair my bicycle");
  await wait(5000);
  const quote = await scene();
  check("…names the price and the wait", /40 coins, and about 2 minutes/.test(quote ?? ""), quote);
  await shot("3-quote");

  await clickText("That's OK");
  await wait(4000);
  const work = await scene();
  check("…takes the coins and gets to work, with a countdown", /I'm on it/.test(work ?? "") && /Ready in 1:\d\d/.test(work ?? ""), work);
  check("40 coins paid", (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins === 60);
  await shot("4-working");

  // ---- Back once it's ready
  await admin.from("repair_jobs").update({ ready_at: ago(1) }).eq("id", j.id);
  await admin.from("player_vehicles").update({ repair_ready_at: ago(1) }).eq("user_id", id).eq("kind", "bicycle");
  await clickText("I'll come back later");
  await open();
  check("back at the shop", await clickText("Back to the shop"));
  await wait(3500);
  const ready = await scene();
  check("…it's ready", /Your bicycle is ready/.test(ready ?? ""), ready);
  await shot("5-ready");
  await clickText("Thank you!");
  await wait(3000);
  const bike = (await admin.from("player_vehicles").select("broken_at, tyre").eq("user_id", id).eq("kind", "bicycle").single()).data;
  check("collected: the bicycle is mended", !bike.broken_at && bike.tyre === 100);
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
