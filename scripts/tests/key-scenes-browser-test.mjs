// Every key's place as a scene (phone): one throwaway hunt whose key is set to each scene in turn (a market, a
// monument plaza, a beach, a park, a motor park, a school, a football pitch, a palace); a fresh hunter at the spot opens
// the chest and the trial is asked there by the place's keeper (Iya Oloja, Guide Bayo…). A picture of each.
// The hunt and the test players are deleted.   SHOTS=<folder> [ONLY=market,beach] node scripts/tests/key-scenes-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
const ids = [];
let huntId = null;
let browser;
let fails = 0;
// An answer already locked in for the first riddle (the riddle clock), far from any key: tests start at the chest.
const LOCKED = { guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 };
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

const KEEPERS = {
  market: "Iya Oloja",
  landmark: "Guide Bayo",
  beach: "Ebi the fisherman",
  park: "Uche the park keeper",
  motor_park: "Sule the conductor",
  school: "Musa the gateman",
  stadium: "Coach Gbenga",
  palace: "Dogari the palace guard",
};
const scenes = process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(KEEPERS);
const spot = { lng: 3.378214, lat: 6.500147 }; // a road in Yaba
const near = { lng: spot.lng, lat: spot.lat + 25 / 110574 };

try {
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Key scenes test (automated)", prize: "none", winners: 3, starts_at: ago(600), ends_at: soon(7200), published: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  const { error: keyErr } = await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The test key.", category: "maths", area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, spot_lng: spot.lng, spot_lat: spot.lat, scene: "circle" });
  if (keyErr) throw keyErr;
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

  for (const scene of scenes) {
    await admin.from("hunt_keys").update({ scene }).eq("hunt_id", huntId).eq("n", 1);
    const email = `scene-${scene}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const id = data.user.id; ids.push(id);
    await admin.from("profiles").update({ home_lng: near.lng, home_lat: near.lat, home_set_at: new Date().toISOString() }).eq("id", id);
    await admin.from("player_positions").upsert({ user_id: id, lng: near.lng, lat: near.lat, mode: "walk", energy: 90, updated_at: ago(30) });
    await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, ...LOCKED });
    const jar = new Map();
    const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
    await c.auth.signInWithPassword({ email, password });

    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.evaluateOnNewDocument((h) => {
      try { localStorage.setItem(`loota:riddle-seen:${h}`, "1"); } catch {}
    }, huntId);
    await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(20000);
    const chest = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Open the key's chest");
      b?.click();
      return !!b;
    });
    await wait(4500);
    const strip = await page.evaluate((nl) => document.querySelector('[aria-label="Key Trial"]')?.innerText.split(nl).join(" | ") ?? null, NL);
    const asker = KEEPERS[scene];
    check(`${scene}: the chest, then the trial asked there by ${asker}`, chest && new RegExp(`${asker}:`, "i").test(strip ?? ""), strip?.slice(0, 140));
    await page.screenshot({ path: `${OUT}/keyscene-${scene}.png` });
    if (problems.length) check(`${scene}: no page errors`, false, problems.join(" / "));
    await page.close();
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId).eq("user_id", id);
  }
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    const { error } = await admin.from("hunts").delete().eq("id", huntId);
    if (error) console.log("hunt cleanup failed:", error.message);
  }
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
