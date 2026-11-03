// A story hunt's scroll on a phone, one page a chapter (owner, 3 Nov 2026: "each chapter should just be 1 page, no
// next. If next, that means you go to chapter 2"): a hunter who joins HUNT (default: the endless test hunt) opens the
// scroll on the opening and chapter 1 together, the page fits the screen without scrolling, and there's no Next button
// while chapter 2 is locked. The test player is deleted.
//   HUNT=<id> SHOTS=<folder> node scripts/tests/story-one-page-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const HUNT = process.env.HUNT ?? "d4c65372-1efb-4232-a399-d819e059be80";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `one-page-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const joined = await c.rpc("join_hunt", { p_hunt: HUNT });
  check("joined the hunt", !joined.error, joined.error?.message);
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, id);
  await page.goto(`http://localhost:3000/play?hunt=${HUNT}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);
  await page.evaluate(() => document.querySelector('[data-tool="story"]')?.click());
  await wait(1200);
  const view = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="The story"]');
    const body = d?.querySelector("article")?.parentElement;
    return d
      ? {
          chapter: d.querySelector("article")?.getAttribute("data-chapter"),
          text: d.querySelector("article")?.innerText ?? "",
          fits: body ? body.scrollHeight <= body.clientHeight + 2 : false,
          heights: body ? `${body.scrollHeight}/${body.clientHeight}` : "",
          next: [...d.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "").filter((t) => /›|Next/.test(t)),
          locked: d.querySelector("[data-next-locked]")?.textContent ?? "",
        }
      : null;
  });
  await page.screenshot({ path: `${OUT}/story-one-page.png` });
  check("the scroll opens on chapter 1, with the opening on the same page", view?.chapter === "1" && /biscuit tin/.test(view.text) && /CHAPTER 1/.test(view.text), view?.text.slice(0, 160));
  check("…the page fits a phone without scrolling", !!view?.fits, view?.heights);
  check("…no Next while chapter 2 is locked; it says which key opens it", view?.next.length === 0 && /Chapter 2 opens when you find Key 1/.test(view.locked), `${view?.next.join(", ")} · ${view?.locked}`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
