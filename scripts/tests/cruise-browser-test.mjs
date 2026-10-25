// Cruise on a phone (owner, 25 Oct 2026: "a cruise button… move without pressing the keys… it can only go straight").
// A walker in Yaba with 3 tokens: the day's 2 free (5), CRUISE beside SPRINT; a token lying 5 m from where they stand,
// picked up (6);
// tapping CRUISE: a token spent (5) and the hunter goes on by themselves, no key pressed; tapping again: stops. The
// inventory sells them. The test player and drop are deleted.
//   SHOTS=<folder> node scripts/tests/cruise-browser-test.mjs
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
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, dropId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const home = { lng: 3.3787, lat: 6.5186 }; // Yaba
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 110400, (a.lat - b.lat) * 110574);

try {
  const email = `cruiseb-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ coins: 100, cruise_tokens: 3, home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: home.lng, lat: home.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

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
  await page.evaluateOnNewDocument((uid) => {
    try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {}
  }, id);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  const button = () => page.evaluate(() => {
    const b = document.querySelector('button[aria-label^="Cruise"]');
    return b ? { label: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed") } : null;
  });
  // Once the hunter stands on the road: a token lying 5 m from them.
  await wait(20000);
  const { data: stand } = await admin.from("player_positions").select("lng, lat").eq("user_id", id).single();
  const { data: d } = await admin.from("cruise_drops").insert({ cell: "test", lng: stand.lng, lat: stand.lat + 5 / 110574, expires_at: new Date(Date.now() + 3600e3).toISOString() }).select("id").single();
  dropId = d.id;
  let b = null;
  for (let i = 0; i < 40; i++) {
    await wait(1000);
    b = await button();
    if (/6 tokens/.test(b?.label ?? "")) break;
  }
  check("CRUISE beside SPRINT", !!b && (await page.evaluate(() => [...document.querySelectorAll("button")].some((x) => x.textContent?.trim() === "SPRINT"))), b?.label);
  const t = (await admin.from("profiles").select("cruise_tokens").eq("id", id).single()).data.cruise_tokens;
  check("3 tokens + the day's 2 free + the one lying 5 m away: 6", /6 tokens/.test(b?.label ?? "") && t === 6, `${b?.label} · server ${t}`);
  await page.screenshot({ path: `${OUT}/cruise-1-ready.png` });

  // Cruise: no key pressed, the hunter goes on.
  await page.evaluate(() => document.querySelector('button[aria-label^="Cruise"]')?.click());
  await wait(1500);
  b = await button();
  check("tapped: cruise on, a token spent (5)", b?.pressed === "true" && /5 tokens/.test(b.label ?? ""), b?.label);
  await wait(9000);
  await page.screenshot({ path: `${OUT}/cruise-2-on.png` });
  const { data: pos } = await admin.from("player_positions").select("lng, lat").eq("user_id", id).single();
  check("…the hunter went on by themselves (no key pressed)", metres(pos, home) > 8, `${Math.round(metres(pos, home))} m`);
  await page.evaluate(() => document.querySelector('button[aria-label^="Cruise"]')?.click());
  await wait(1000);
  b = await button();
  check("tapped again: cruise off", b?.pressed === "false", b?.label);

  // The inventory sells them.
  await page.evaluate(() => document.querySelector('button[aria-label^="Inventory"]')?.click());
  await wait(1500);
  const inv = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
  check("the inventory: cruise tokens, and buying more", /Cruise tokens · \d\/8/.test(inv) && /Buy \d · \d+/.test(inv), inv.slice(0, 200).split("\n").join(" | "));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (dropId) await admin.from("cruise_drops").delete().eq("id", dropId);
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
