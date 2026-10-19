// Is there a ticket office where a player stands? A test player at <lng> <lat> on [mode]: the gold buttons shown,
// what the travel panel says about the train, and a screenshot. The test player is deleted.
//   SHOT=<file.png> node scripts/tests/ticket-probe.mjs <lng> <lat> [mode]
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [lng, lat] = [Number(process.argv[2]), Number(process.argv[3])];
const mode = process.argv[4] ?? "walk";
const email = `ticketprobe-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const id = data.user.id;
let browser;
try {
  await admin.from("profiles").update({ home_lng: lng, home_lat: lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Ticket probe" });
  if (mode !== "walk") await admin.from("player_vehicles").insert({ user_id: id, kind: mode, fuel: 80, tyre: 100, engine: 100, lng, lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: id, lng, lat, mode, energy: 100, updated_at: new Date(Date.now() - 20000).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);
  const buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter((t) => t && t.length < 40));
  console.log("buttons:", JSON.stringify(buttons));
  await page.screenshot({ path: process.env.SHOT ?? "ticket.png" });
  await page.evaluate(() => document.querySelector('[data-tool="transit"]')?.click());
  await wait(3000);
  console.log("travel panel:", (await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "")).replace(/\n+/g, " | ").slice(0, 600));
} finally {
  await browser?.close();
  await admin.auth.admin.deleteUser(id);
}
