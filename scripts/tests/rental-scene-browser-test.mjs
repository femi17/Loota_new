// Renting as a scene (phone): the renter waiting at the stop → "Rent it" opens the scene → greeting → "How much is it?"
// → the rate → "I've changed my mind" (the renter goes) → called again → "Deal!" → riding the rented bicycle.
// The test player is deleted.   SHOTS=<folder> [KIND=motorbike] node scripts/tests/rental-scene-browser-test.mjs
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
const KIND = process.env.KIND === "motorbike" ? "motorbike" : "bicycle"; // KIND=motorbike: an okada instead
try {
  const email = `rental-b-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 100, p_kind: "admin", p_reason: "Rental scene test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 90, updated_at: ago(30) });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  // The renter comes to where the player stands (as when no bus stop is near).
  const callRenter = async () => (await c.rpc("request_pickup", { p_kind: KIND, p_lng: yaba.lng, p_lat: yaba.lat, p_name: "Herbert Macaulay Way" })).data;

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll("button")].find((y) => (y.textContent?.includes(x) || y.getAttribute("aria-label")?.includes(x)) && !y.disabled); b?.click(); return !!b; }, t);
  const shot = (name) => page.screenshot({ path: `${OUT}/rental-${name}.png` });
  const scene = () => text('[role="dialog"]');
  const open = async () => {
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };
  const pickupOpen = async () => !!(await admin.from("vehicle_pickups").select("ended_at").eq("user_id", id).is("ended_at", null).maybeSingle()).data;

  // ---- First time: changed my mind
  check("the renter is called", (await callRenter())?.ok === true);
  await open();
  check("at the renter: Rent it", await clickText("Rent it"));
  await wait(3500);
  const greet = await scene();
  check(`the renter greets you with the ${KIND}`, (KIND === "bicycle" ? /You called for a bicycle\? Here she is/ : /You called for an okada\? Here it is/).test(greet ?? ""), greet);
  await shot("1-greet");
  await clickText("How much is it?");
  await wait(5000);
  const price = await scene();
  check("…and names the rate", new RegExp(`${KIND === "bicycle" ? 4 : 10} coins a minute\\. The meter starts when you ride off`).test(price ?? ""), price);
  await shot("2-price");
  await clickText("That's too much for me");
  await wait(3000);
  check("too much: no wahala", /No wahala/.test((await scene()) ?? ""));
  await clickText("Bye");
  await wait(2500);
  check("…and the renter goes", !(await pickupOpen()));

  // ---- Called again: the deal
  await page.goto("about:blank");
  check("the renter is called again", (await callRenter())?.ok === true);
  await open();
  await clickText("Rent it");
  await wait(3500);
  await clickText("How much is it?");
  await wait(5000);
  await clickText("Deal!");
  await wait(4000);
  const deal = await scene();
  check("deal: safe journey", /Safe journey/.test(deal ?? ""), deal);
  await shot("3-deal");
  const rented = (await admin.from("vehicle_rentals").select("kind").eq("user_id", id).is("ended_at", null).maybeSingle()).data;
  const pos = (await admin.from("player_positions").select("mode").eq("user_id", id).single()).data;
  check(`riding the rented ${KIND}, the meter running`, rented?.kind === KIND && pos.mode === KIND, JSON.stringify({ rented, mode: pos.mode }));
  await clickText("Thanks! Let's go");
  await wait(1500);
  check("the scene closes", !(await scene())?.includes("Safe journey"));
  await shot("4-riding");
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
