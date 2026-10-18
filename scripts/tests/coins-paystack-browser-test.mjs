// Buying coins in Paystack's test mode (phone): tap the coins → the shop with naira prices → a pack → Paystack's real
// checkout opens; then a payment with the test card (made through Paystack's API: its checkout page is behind a bot
// check) and back to the game as Paystack sends the player: checked with Paystack, the coins added.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/coins-paystack-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const email = `paystack-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  const spot = { lng: 3.378214, lat: 6.500147 };
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 90, updated_at: new Date().toISOString() });
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
  // No payment window: Paystack's own page (the same checkout, and the way back to the game is tested too).
  await page.evaluateOnNewDocument(() => {
    if (location.hostname === "localhost") Object.defineProperty(window, "PaystackPop", { get: () => undefined, set: () => {}, configurable: true });
  });
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(16000);
  const shot = (n) => page.screenshot({ path: `${OUT}/paystack-${n}.png` });

  // ---- The shop
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /coins: buy more/.test(b.getAttribute("aria-label") ?? ""))?.click());
  await wait(1200);
  const shop = await page.evaluate(() => document.querySelector('[aria-label="Buy coins"]')?.innerText ?? null);
  check("tap the coins: the shop, with naira prices", /Buy coins/.test(shop ?? "") && /₦1,000/.test(shop ?? "") && /Test mode/.test(shop ?? ""), shop?.slice(0, 160));
  await shot("1-shop");
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Buy coins"] button')].find((b) => /A pouch/.test(b.getAttribute("aria-label") ?? ""))?.click());
  await page.waitForNavigation({ timeout: 60000 }).catch(() => {});
  await wait(6000);
  check("…a pack: Paystack's checkout", /checkout\.paystack\.com/.test(page.url()), page.url());
  await shot("2-checkout");

  // (Paystack's checkout sits behind a Cloudflare bot check: a test can't fill the card in. The payment itself is
  // made with the test card through Paystack's API, as the checkout would, for a purchase of this player's; then back
  // to the game the way Paystack sends the player, where the payment is checked with Paystack and the coins added.)
  const { randomUUID } = await import("node:crypto");
  const ref = `loota_${randomUUID()}`;
  await admin.from("coin_purchases").insert({ reference: ref, user_id: id, pack: "pouch", coins: 1200, amount_kobo: 100000 });
  const charge = await fetch("https://api.paystack.co/charge", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, amount: 100000, reference: ref, card: { number: "4084084084084081", cvv: "408", expiry_month: "12", expiry_year: "30" }, pin: "0000" }),
  }).then((r) => r.json());
  check("paid with the test card at Paystack", charge.status === true, charge.message);
  await page.goto(`http://localhost:3000/play?paid=${ref}&trxref=${ref}&reference=${ref}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(16000);
  const coins = (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const back = await page.evaluate(() => document.querySelector('[aria-label="Buy coins"]')?.innerText ?? null);
  check("back in the game: checked with Paystack, +1,200 coins", coins === 1200 && /\+1,200 coins/.test(back ?? ""), `${coins} coins · ${back?.split(String.fromCharCode(10)).slice(-4).join(" | ")}`);
  const chip = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "").find((l) => /coins: buy more/.test(l)));
  check("…and the coin count shows it", /^1200 coins/.test(chip ?? ""), chip);
  check("…the address cleaned", !/paid=/.test(page.url()), page.url());
  await shot("3-back");
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
