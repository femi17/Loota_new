// A new player's first hour (owner, 20 Oct 2026), on a phone, with a screenshot at every step to look at as a stranger
// would: home, sign up (its checks), log in, onboarding (look, home from the phone's location), the lobby (welcome coins,
// the practice hunt), the map and each panel (help, vehicles, travel, landmarks, the lamp, the inventory).
// The test player is created confirmed (the real sign-up mails a link) and deleted.
//   SHOTS=<folder> node scripts/tests/first-hour-walkthrough.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const NL = String.fromCharCode(10);
const BASE = "http://localhost:3000";
let id = null, browser;
const home = { lng: 3.3787, lat: 6.5186 }; // Yaba
const note = (...a) => console.log(...a);

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, ["geolocation"]);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setGeolocation({ latitude: home.lat, longitude: home.lng, accuracy: 20 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`); });
  let n = 0;
  const shot = async (name, fullPage = false) => { n++; await page.screenshot({ path: `${OUT}/first-${String(n).padStart(2, "0")}-${name}.png`, fullPage }); };
  const waitFor = async (re, tries = 60) => { for (let i = 0; i < tries; i++) { if (re.test(await body())) return true; await wait(1000); } return false; };
  const body = () => page.evaluate((nl) => document.body.innerText.split(nl).filter(Boolean).join(" | "), NL);
  const clickText = (t, sel = "button, a") => page.evaluate((x, s) => { const b = [...document.querySelectorAll(s)].find((e) => e.textContent?.trim().includes(x)); b?.click(); return !!b; }, t, sel);

  // ---- Home and sign up
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120000 });
  await shot("home");
  await clickText("Play now");
  await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});
  await shot("signup");
  note("SIGNUP PAGE:", (await body()).slice(0, 300));
  await page.type('input[name="username"]', "a!");
  await page.type('input[name="email"]', "not-an-email");
  await page.type('input[name="password"]', "short");
  await clickText("Create", "button");
  await wait(2500);
  note("SIGNUP CHECK:", (await body()).match(/(Hunter name[^|]*|Enter a valid[^|]*|Password must[^|]*)/)?.[0] ?? "no error shown");
  await shot("signup-error");

  // ---- A confirmed player, then log in
  const username = `Newbie${Date.now().toString().slice(-6)}`;
  const email = `firsthour-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
  id = data.user.id;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await clickText("Log in", "button");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  note("AFTER LOGIN:", page.url());
  await shot("after-login");
  if (!page.url().includes("onboarding")) await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  await shot("onboarding");
  note("ONBOARDING:", (await body()).slice(0, 500));
  // Share the location, then start
  await clickText("location", "button");
  await wait(2500);
  await shot("onboarding-located", true);
  const startBtn = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean));
  note("ONBOARDING BUTTONS:", JSON.stringify(startBtn));
  await page.evaluate(() => [...document.querySelectorAll('button[type="submit"]')].at(-1)?.click());
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  note("AFTER ONBOARDING:", page.url());
  await waitFor(/Free roam/);
  await shot("lobby", true);
  note("LOBBY:", (await body()).slice(0, 700));
  const coins = (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  note("COINS AFTER ONBOARDING:", coins);

  // ---- The map
  await page.goto(`${BASE}/play`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  // The welcome tour (a newcomer: welcomed with coins at onboarding), card by card
  const tour = await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Welcome to Loota"]'));
  note("WELCOME TOUR SHOWN:", tour);
  for (let i = 0; i < 4 && tour; i++) {
    await shot(`tour-${i + 1}`);
    note(`TOUR ${i + 1}:`, (await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Welcome to Loota"]')?.innerText ?? "")).replace(/\n+/g, " | ").slice(0, 300));
    await clickText(i < 3 ? "Next" : "Later", "button");
    await wait(700);
  }
  await shot("map");
  note("MAP:", (await body()).slice(0, 400));
  for (const [tool, label] of [["help", 'button[aria-label="Help"]'], ["vehicles", '[data-tool="travel"]'], ["transit", '[data-tool="transit"]'], ["landmarks", '[data-tool="landmarks"]'], ["lamp", '[data-tool="lamp"]'], ["inventory", 'button[aria-label^="Inventory"]'], ["directions", '[data-tool="directions"]']]) {
    await page.evaluate((s) => document.querySelector(s)?.click(), label);
    await wait(2500);
    await shot(tool);
    note(`${tool.toUpperCase()}:`, (await body()).slice(0, 500));
    // Close whatever opened (the help toggles on its own button)
    if (tool === "help") await page.evaluate((s) => document.querySelector(s)?.click(), label);
    else await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button[aria-label="Close"]')].at(-1)?.click());
    await page.keyboard.press("Escape");
    await wait(1200);
  }
  // The tour put away ("Later"): the hunt invitation on the map, then joining it
  await waitFor(/A hunt is live/, 20);
  await shot("invite");
  note("INVITE:", ((await body()).match(/A hunt is live[^]*?Join/)?.[0] ?? "none").slice(0, 200));
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[type="submit"]')?.click());
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  note("AFTER JOIN:", page.url());
  await waitFor(/Let.s go|The hunt is on/, 40);
  await wait(1500);
  await shot("first-riddle");
  note("FIRST RIDDLE:", ((await body()).match(/The hunt is on[^]*?Let.s go/)?.[0] ?? (await body()).slice(0, 300)).slice(0, 300));
  await clickText("Let's go", "button");
  await wait(2000);
  await shot("hunt-card");
  note("HUNT CARD:", (await page.evaluate(() => document.querySelector('section[aria-label="Hunt"]')?.innerText ?? "")).replace(/\n+/g, " | ").slice(0, 400));
  // Far from the key: no Search here, and the card says it appears on arrival
  await wait(10000);
  note("SEARCH HERE AT HOME (should be false):", await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Hunt"] button')].some((b) => b.textContent?.trim() === "Search here")));
  note("HINT:", /appears when you reach the key.s area/i.test(await body()));
  // A newcomer guesses the airport: Directions, search it
  if (!(await page.$('input[type="search"]'))) await page.evaluate(() => document.querySelector('[data-tool="directions"]')?.click());
  await wait(800);
  await page.type('input[type="search"]', "Murtala Muhammed Airport", { delay: 40 });
  await wait(4000);
  await shot("search");
  note("SEARCH:", (await body()).slice(0, 500));
  await page.evaluate(() => document.querySelector('[role="listbox"] [role="option"] button')?.click());
  await wait(8000);
  await shot("journey");
  note("JOURNEY:", (await body()).slice(0, 700));
  note("COINS NOW:", (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins);
  note("PROBLEMS:", problems.join(" // ") || "none");
} catch (e) {
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log("test player deleted");
}
