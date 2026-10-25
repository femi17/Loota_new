// The Masquerade's trap chest on a phone (owner, 25 Oct 2026): a throwaway hunt whose Key 1 has a decoy 220 m from its
// spot; the hunter stands 15 m from the decoy. A chest rises and "Open the chest" shows, the same as the real one; the
// heat chip says Hot or Warm, not Burning; opening it: the trap sound, the Masquerade's scene, 25 coins gone, then
// "Dizzy!" and no Key Trial. The hunt and test player are deleted.
//   SHOTS=<folder> node scripts/tests/trap-chest-browser-test.mjs
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
const spot = { lng: 3.378214, lat: 6.500147 };
const north = (p, m) => ({ lng: p.lng, lat: p.lat + m / 110574 });
const trap = north(spot, 220);

try {
  const email = `trapb-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  const start = north(trap, 15);
  await admin.from("profiles").update({ coins: 100, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Trap chest test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Trap key.", category: "maths", trial_kind: "sentries", area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, spot_lng: spot.lng, spot_lat: spot.lat, trap_lng: trap.lng, trap_lat: trap.lat });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  // No road scenes in the way.
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
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
  }, huntId, id);
  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });

  const button = () => page.evaluate(() => !!document.querySelector('button[aria-label="Open the key\'s chest"]'));
  let shown = false;
  for (let i = 0; i < 40 && !shown; i++) {
    await wait(1000);
    shown = await button();
  }
  check("15 m from the decoy: a chest rises, Open the chest", shown);
  const chip = await page.evaluate(() => document.querySelector('[aria-label^="The key\'s heat"]')?.textContent ?? null);
  check("…the heat chip isn't Burning (the tell)", !!chip && !/Burning/.test(chip), chip);
  await page.screenshot({ path: `${OUT}/trap-1-chest.png` });

  await page.evaluate(() => document.querySelector('button[aria-label="Open the key\'s chest"]')?.click());
  let story = null;
  for (let i = 0; i < 20 && !/BOING|smoke/.test(story ?? ""); i++) {
    await wait(500);
    story = await page.evaluate(() => (document.querySelector('[role="dialog"][aria-label="Story"]') ? document.querySelector('[role="dialog"][aria-label="Story"]').innerText : null));
  }
  check("opened: the Masquerade's scene", /BOING|smoke/.test(story ?? ""), story?.split("\n").join(" | "));
  const cues = await page.evaluate(() => window.__lootaCues ?? []);
  check("…the trap sound", cues.includes("trap"), cues.join(","));
  await page.screenshot({ path: `${OUT}/trap-2-scene.png` });
  // Tap through the lines.
  for (let i = 0; i < 12 && (await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Story"]'))); i++) {
    await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Story"]')?.click());
    await wait(400);
  }
  const heldBeats = (await page.evaluate(() => window.__lootaCues ?? [])).slice(cues.length).filter((x) => x === "heartbeat").length;
  check("…no heartbeat while the scene is up", heldBeats === 0, `${heldBeats}`);
  const dizzy = await page.evaluate(() => document.querySelector('[role="status"][aria-label="Dizzy"]')?.textContent ?? null);
  check("…then Dizzy!", !!dizzy && /Dizzy/.test(dizzy), dizzy);
  check("…no Key Trial (it was a decoy)", !(await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Key Trial"]'))));
  check("…and the chest is gone", !(await button()));
  await page.screenshot({ path: `${OUT}/trap-3-dizzy.png` });
  const { data: me } = await admin.from("profiles").select("coins").eq("id", id).single();
  check("25 coins lost", me.coins === 75, `${me.coins}`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
