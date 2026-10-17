// The pocket garage in the browser (phone): a motorbike last ridden 110 km away is "in your pocket" in the vehicle
// panel, comes out with "Take it out" (growing under the hunter), and shrinks back into the pocket on getting off.
// The test player is deleted.   SHOTS=<folder> node scripts/tests/pocket-garage-browser-test.mjs
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
const ibadan = { lng: 3.8964, lat: 7.3775 };
try {
  const email = `pocket-b-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 80, tyre: 100, engine: 100, lng: ibadan.lng, lat: ibadan.lat, in_use: false });
  const mode = async () => (await admin.from("player_positions").select("mode").eq("user_id", id).single()).data.mode;

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
  const hint = () => page.evaluate(() => document.querySelector('p[role="status"]')?.textContent ?? "");
  const shot = (name) => page.screenshot({ path: `${OUT}/pocket-${name}.png` });
  /** Wait for the game to say something (the animation starts as it does), then a moment more. */
  const whenSaid = async (re, ms) => {
    for (let i = 0; i < 60 && !re.test(await hint()); i++) await wait(100);
    await wait(ms);
  };

  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);

  // ---- The panel: in your pocket, Take it out
  await page.evaluate(() => document.querySelector('[data-tool="travel"]')?.click());
  await wait(1000);
  const panel = await text('[aria-label="Vehicles"]');
  check("the panel says the motorbike is in your pocket", /in your pocket/.test(panel ?? ""), panel?.slice(0, 200));
  check("…with Take it out, and no Walk to it", /Take it out/.test(panel ?? "") && !/Walk to it/.test(panel ?? ""));
  await shot("1-panel");

  await clickText("Take it out");
  await whenSaid(/Out of your pocket/, 200);
  await shot("2-growing");
  await wait(3000);
  check("out of the pocket in Yaba (last ridden in Ibadan): riding it", (await mode()) === "motorbike", await hint());

  // ---- Off it: into the pocket
  await page.evaluate(() => document.querySelector('[data-tool="travel"]')?.click());
  await wait(1000);
  await clickText("Get off and walk");
  await whenSaid(/shrinks into your pocket/, 150);
  await shot("3-shrinking");
  await wait(3000);
  check("getting off: on foot, and the game says it's in your pocket", (await mode()) === "walk" && /pocket/.test(await hint()), await hint());
  await shot("4-pocketed");
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
