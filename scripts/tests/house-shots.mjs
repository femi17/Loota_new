// Pictures of a story hunt's houses on a phone, the whole house and close up (owner, 1 Nov 2026: "the house can be
// alot different… well visible… only 3 rooms"). Each house is copied into a throwaway hunt; walks into its right room.
// DESKTOP=1: a laptop screen instead of a phone; SIZE=1276x585: any screen.
// Everything made is deleted.   SHOTS=<folder> [HUNT=<id>] [KEYS=1,2,3] [DESKTOP=1] node scripts/tests/house-shots.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const HUNT = process.env.HUNT ?? "45b94806-a16a-4e88-8eae-7337474a71f3";
const KEYS = (process.env.KEYS ?? "1,2,3").split(",").map(Number);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const work = { keys: 1, writer: "test", designs: {}, decoys: {}, map: {}, spent: {}, done: true, log: [], skeleton: { title: "Shots", logline: "x", villain: { name: "x", motive: "x" }, heroes: [], worldRules: [], chapters: [], keys: [] }, chapters: {} };
let browser, fails = 0;
const made = { users: [], hunts: [] };

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  for (const n of KEYS) {
    const { data: k } = await admin.from("hunt_keys").select("spot_lng, spot_lat, house").eq("hunt_id", HUNT).eq("n", n).single();
    const email = `shots-${n}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const id = data.user.id;
    made.users.push(id);
    await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
    await admin.from("player_positions").upsert({ user_id: id, lng: k.spot_lng, lat: k.spot_lat, mode: "walk", energy: 100, updated_at: ago(30) });
    const { data: h } = await admin.from("hunts").insert({ title: "House shots (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true, story: work, story_status: "ready" }).select("id").single();
    made.hunts.push(h.id);
    await admin.from("hunt_keys").insert({ hunt_id: h.id, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: k.spot_lng, area_lat: k.spot_lat, area_radius_m: 1500, spot_lng: k.spot_lng, spot_lat: k.spot_lat, exact_m: 120, house: k.house });
    await admin.from("hunt_players").insert({ hunt_id: h.id, user_id: id });
    const jar = new Map();
    const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
      getAll: () => [...jar].map(([nm, value]) => ({ name: nm, value })),
      setAll: (list) => list.forEach(({ name: nm, value }) => (value ? jar.set(nm, value) : jar.delete(nm))) } });
    await c.auth.signInWithPassword({ email, password });
    const page = await (await browser.createBrowserContext()).newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setViewport(process.env.SIZE ? { width: Number(process.env.SIZE.split("x")[0]), height: Number(process.env.SIZE.split("x")[1]) } : process.env.DESKTOP ? { width: 1366, height: 768 } : { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setCookie(...[...jar].map(([nm, value]) => ({ name: nm, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, id);
    await page.goto(`http://localhost:3000/play?hunt=${h.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
    await until(() => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Go inside"))), 60000);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Go inside"))?.click());
    await until(() => page.evaluate(() => !!document.querySelector('[aria-label="Inside the house"] canvas')));
    await wait(1500);
    await page.evaluate(() => document.querySelector('[aria-label="See the whole house"]')?.click());
    await wait(1500);
    await page.screenshot({ path: `${OUT}/house-key${n}-whole.png` });
    await page.evaluate(() => document.querySelector('[aria-label="Closer"]')?.click());
    await wait(1200);
    await page.screenshot({ path: `${OUT}/house-key${n}-close.png` });
    const right = k.house.rooms.find((r) => r.role === "right").id;
    await until(() => page.evaluate(() => document.querySelector('[aria-label="Inside the house"]')?.getAttribute("data-busy") === "false"), 20000);
    await page.evaluate((rid) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: { tap: "room", id: rid } })), right);
    const chest = await until(() => page.evaluate(() => /chest/i.test(document.querySelector("[data-house-say]")?.textContent ?? "")), 30000);
    await wait(900);
    await page.screenshot({ path: `${OUT}/house-key${n}-right.png` });
    const ok = !!chest && problems.length === 0;
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"}  key ${n} (${k.house.layout ?? "?"}, ${k.house.rooms.length} rooms): walked into ${right}, chest shown${problems.length ? `; errors: ${problems.join(" / ")}` : ""}`);
  }
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const h of made.hunts) await admin.from("hunts").delete().eq("id", h);
  for (const u of made.users) await admin.auth.admin.deleteUser(u);
  console.log(`hunts and players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
