// The house on a phone (owner, 31 Oct 2026: "an open house, like sims"). A story key with the test house (see
// house-api-test: a study with a portrait hiding a brass key, a cellar and a kitchen that are traps, a locked bedroom
// with the chest). The hunter stands at the place:
//   1. "🚪 Go inside" on the map; the house opens (3D, its rooms, the hunter);
//   2. the bedroom is locked; the cellar is a trap: the soft penalty card, thrown out;
//   3. back in: the study, the portrait gives the brass key (shown in what you carry);
//   4. the bedroom opens with it; the chest; opening it starts the Key Trial;
//   5. a real tap on the house hits something (the 3D picking works).
// The hunt and test player are deleted.   SHOTS=<folder> node scripts/tests/house-browser-test.mjs
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
let id = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const PLACE = { lng: 3.3958, lat: 6.4541 };
const HOUSE = {
  title: "The keeper's house",
  items: { "brass-key": { name: "A small brass key", icon: "🗝️" } },
  rooms: [
    { id: "study", name: "Study", kind: "study", role: "safe", objects: [
      { id: "portrait", kind: "picture", label: "An old man's portrait", look: "A stern old man in a sailor's cap.", gives: "brass-key", found: "You lift the frame. Taped to the back: a small brass key." },
      { id: "desk", kind: "desk", label: "A writing desk", look: "Bills, a pencil, a dried-up inkwell." },
    ] },
    { id: "cellar", name: "Cellar", kind: "cellar", role: "trap" },
    { id: "kitchen", name: "Kitchen", kind: "kitchen", role: "trap" },
    { id: "bedroom", name: "Bedroom", kind: "bedroom", role: "right", needs: "brass-key", lockedText: "Locked. A small brass keyhole.", objects: [{ id: "clock", kind: "clock", label: "A tall clock", look: "It stopped at twelve." }] },
  ],
};

try {
  const email = `housebr-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500 }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "House test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where was the light?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng, area_lat: PLACE.lat, area_radius_m: 1500, spot_lng: PLACE.lng, spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "The light", guess_lng: PLACE.lng, guess_lat: PLACE.lat });

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
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
  }, huntId, id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });

  const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
  const button = async (re) => page.evaluateHandle((src) => [...document.querySelectorAll("button")].find((b) => new RegExp(src).test(b.textContent ?? "")) ?? null, re);
  const say = () => page.evaluate(() => document.querySelector("[data-house-say]")?.textContent ?? "");
  const idle = () => until(() => page.evaluate(() => document.querySelector('[aria-label="Inside the house"]')?.getAttribute("data-busy") === "false"), 20000);
  const tap = async (detail) => {
    await idle(); // the house takes one thing at a time (a tap while walking is ignored)
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: d })), detail);
    await wait(300);
  };


  // 1. Go inside
  const go = await until(async () => (await (await button("Go inside")).jsonValue()) !== null && (await button("Go inside")), 60000);
  check("at the place: 🚪 Go inside", !!go);
  await page.screenshot({ path: `${OUT}/house-0-map.png` });
  await (await button("Go inside")).click();
  const inside = await until(() => page.evaluate(() => !!document.querySelector('[aria-label="Inside the house"] canvas') && document.body.innerText.includes("The keeper's house")));
  check("the house opens: 3D, with its name", !!inside);
  await wait(1500);
  await page.screenshot({ path: `${OUT}/house-1-inside.png` });

  // 5. A real tap on the house picks something
  const before = await say();
  const box = await page.evaluate(() => { const r = document.querySelector("[data-house] canvas").getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.45 }; });
  await page.mouse.click(box.x, box.y);
  const afterTap = await until(async () => (await say()) !== before && (await say()), 10000);
  check("a real tap in the house hits something and the hunter goes", !!afterTap, afterTap ?? "nothing");
  await wait(800);

  // 2. Locked; a trap
  await tap({ tap: "room", id: "bedroom" });
  const locked = await until(async () => /Locked\. A small brass keyhole/.test(await say()) && (await say()), 20000);
  check("the bedroom: locked, with its hint", !!locked, locked ?? (await say()));
  await tap({ tap: "room", id: "cellar" });
  const card = await until(() => page.evaluate(() => document.querySelector('[role="alertdialog"][data-penalty]')?.innerText ?? null), 20000);
  check("the cellar: a trap, the soft penalty card (wrong room), thrown out", !!card && /WRONG ROOM/i.test(card) && !(await page.$('[aria-label="Inside the house"]')), card?.replace(/\s+/g, " ").slice(0, 120));
  await page.screenshot({ path: `${OUT}/house-2-trap.png` });
  await (await button("Get up")).click();
  await admin.from("hunt_players").update({ house_out_until: null }).eq("hunt_id", huntId).eq("user_id", id);

  // 3. Back in: the study and the portrait
  await (await until(async () => (await (await button("Go inside")).jsonValue()) !== null && (await button("Go inside")))).click();
  await until(() => page.evaluate(() => !!document.querySelector('[aria-label="Inside the house"] canvas')));
  await wait(800);
  await tap({ tap: "room", id: "study" });
  await tap({ tap: "object", id: "portrait" });
  const found = await until(async () => /Taped to the back/.test(await say()) && (await say()), 20000);
  const carried = await page.evaluate(() => document.querySelector('[aria-label="What you carry"]')?.textContent ?? "");
  check("the study's portrait: the brass key, carried", !!found && carried.includes("A small brass key"), `${found} | ${carried}`);
  await page.screenshot({ path: `${OUT}/house-3-key.png` });

  // 4. The bedroom, the chest, the Key Trial
  await tap({ tap: "room", id: "bedroom" });
  const opened = await until(async () => /chest/i.test(await say()) && (await say()), 25000);
  check("the bedroom opens with the key; the chest is there", !!opened, opened ?? (await say()));
  await wait(600);
  await page.screenshot({ path: `${OUT}/house-4-chest.png` });
  await tap({ tap: "chest", id: "bedroom" });
  const trial = await until(async () => {
    const { data: t } = await admin.from("trial_attempts").select("id, status").eq("hunt_id", huntId).eq("user_id", id).eq("status", "active").maybeSingle();
    return t;
  }, 20000);
  check("the chest opens: the Key Trial starts", !!trial);
  await wait(2000);
  await page.screenshot({ path: `${OUT}/house-5-trial.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
