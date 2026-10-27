// A long-distance bus abroad (owner, 27 Oct 2026, in Calgary: "I want to go to red deer but it is telling me Looking up
// the bus stations around Red Deer: try again in a minute"), on a phone at the Red Arrow bus station in Calgary: the bus
// panel prices a bus to Red Deer, and to Edmonton, a city no one has gone to yet (its bus stations are brought in while
// the player waits, a few seconds), never "try again". The test player is deleted (what Edmonton's area brings in stays:
// it's the real data the game needs there).
//   SHOTS=<folder> node scripts/tests/intercity-abroad-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const redArrow = { lng: -114.056915, lat: 51.084396 }; // Red Arrow Calgary North (a bus station)

try {
  const email = `intercity-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: redArrow.lng, home_lat: redArrow.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: redArrow.lng, lat: redArrow.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
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
  await wait(15000);
  await page.evaluate(() => document.querySelector('[aria-label="A hunt is live"] button[aria-label="Not now"]')?.click());

  async function busTo(city) {
    await page.evaluate(() => document.querySelector('[data-tool="transit"]')?.click());
    await wait(3000);
    const input = await page.$('[role="dialog"] input');
    if (!input) return "no search box (not at a stop?)";
    await input.click({ clickCount: 3 });
    await input.type(city, { delay: 30 });
    let picked = false;
    for (let i = 0; i < 20 && !picked; i++) {
      await wait(500);
      picked = await page.evaluate((c) => {
        // The city itself ("Red Deer · Alberta, Canada"), not a hospital or a lake named after it.
        const all = [...document.querySelectorAll('[role="dialog"] [role="option"] button')];
        const far = (b) => Number(/([\d,.]+) km$/.exec((b.textContent ?? "").trim())?.[1]?.replace(/,/g, "") ?? 0) > 100; // the city, not "Edmonton Trail" in Calgary
        const opt = all.find((b) => (b.textContent ?? "").startsWith(c) && /Canada/.test(b.textContent ?? "") && far(b) && !/Hospital|Station|River|Lake|Subdivision|County/.test(b.textContent ?? ""));
        opt?.click();
        return !!opt;
      }, city);
    }
    if (!picked) return "no search result";
    let text = "";
    for (let i = 0; i < 60 && !/and board|still being looked up|no .*within|Couldn't|There's no/i.test(text); i++) {
      await wait(1000);
      text = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
    }
    return text;
  }

  for (const city of ["Red Deer", "Edmonton"]) {
    const t0 = Date.now();
    const text = await busTo(city);
    const secs = Math.round((Date.now() - t0) / 1000);
    check(`${city}: a long-distance bus priced`, /Pay \d+ coins and board/.test(text), `${secs} s: ${text.split("\n").filter(Boolean).slice(-4).join(" | ").slice(0, 200)}`);
    check(`${city}: never "try again in a minute"`, !/try again in a minute|still being looked up/.test(text));
    await page.screenshot({ path: `${OUT}/intercity-${city.replace(/\W/g, "")}.png` });
    await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click());
    await wait(1000);
  }
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
