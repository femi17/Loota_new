// The map's credits as just the ⓘ icon (owner, 7 Nov 2026: "The openfreemap on the bottom of the page, just change it to
// only icon removing all the letters"): on a phone and a laptop the credits' words are hidden once the map has loaded,
// and tapping the icon still shows them. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/attribution-browser-test.mjs
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
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const email = `attrib-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const credits = (page) => page.evaluate(() => {
    const el = document.querySelector(".maplibregl-ctrl-attrib");
    const inner = el?.querySelector(".maplibregl-ctrl-attrib-inner");
    const button = el?.querySelector(".maplibregl-ctrl-attrib-button");
    return { found: !!el, words: inner ? getComputedStyle(inner).display !== "none" : false, icon: button ? getComputedStyle(button).display !== "none" : false, text: inner?.textContent ?? "" };
  });
  for (const [name, viewport] of [["phone", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ["laptop", { width: 1366, height: 768 }]]) {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport(viewport);
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(15000);
    const folded = await credits(page);
    check(`${name}: the credits are just the icon, no words`, folded.found && folded.icon && !folded.words, JSON.stringify({ ...folded, text: folded.text.slice(0, 60) }));
    await page.screenshot({ path: `${OUT}/attribution-${name}.png` });
    await page.evaluate(() => document.querySelector(".maplibregl-ctrl-attrib-button")?.click());
    await wait(500);
    const opened = await credits(page);
    check(`${name}: tapping the icon shows them (OpenFreeMap, OpenStreetMap)`, opened.words && /OpenStreetMap/.test(opened.text), opened.text.slice(0, 80));
    check(`${name}: no page errors`, problems.length === 0, problems.join(" / "));
    await page.close();
  }
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
