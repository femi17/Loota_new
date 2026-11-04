// The quick Key Trial puzzles on a phone (owner, 4 Nov 2026: "Remove this sentrie game, replace with something else,
// also, do not forget we can have grammar, simple algebra, type 5 coutries starting with L, guess the flag, guess the
// Logo or guess the brand"; "The guess the logo should be an image"): a throwaway hunt with a Grammar, an Algebra, a
// Name-the-countries, a Guess-the-flag and a Guess-the-logo key at one spot. At each chest the board opens; the test
// plays it like a player (taps the answers, types the numbers and the countries; the answers read from the database)
// and the key is won. Screenshots of each board. The hunt and test player are deleted.
//   SHOTS=<folder> node scripts/tests/quick-puzzles-browser-test.mjs
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
const LOCKED = { guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 };
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const spot = { lng: 3.378214, lat: 6.500147 }; // on a road in Yaba
const KINDS = ["grammar", "algebra", "countries", "flags", "brands"];

try {
  const email = `puzzle-quick-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    // A story hunt (no Masquerade scenes between keys to cover the boards)
    .insert({ title: "Quick puzzles test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true, story_status: "ready",
      story: { keys: 5, writer: "test", designs: {}, decoys: {}, map: {}, spent: {}, done: true, log: [], skeleton: { title: "Puzzles", logline: "x", villain: { name: "x", motive: "x" }, heroes: [], worldRules: [], chapters: [], keys: [] }, chapters: {} } })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert(KINDS.map((kind, i) => ({ hunt_id: huntId, n: i + 1, relay: false, riddle: `Test stop ${i + 1}.`, category: "maths", trial_kind: kind, area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, spot_lng: spot.lng, spot_lat: spot.lat })));
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, ...LOCKED });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
    } catch {}
  }, huntId, id);
  const shot = (name) => page.screenshot({ path: `${OUT}/puzzle-quick-${name}.png` });
  const IN = '[role="dialog"][aria-label="Key Trial"]';
  const button = (text) => page.evaluate((t, s) => {
    const b = [...document.querySelectorAll(`${s} button`)].find((x) => x.textContent?.trim().startsWith(t));
    b?.click();
    return !!b;
  }, text, IN);
  const attempt = async () => (await admin.from("trial_attempts").select("id, kind, solution, puzzle").eq("hunt_id", huntId).eq("user_id", id).eq("status", "active").maybeSingle()).data;

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);

  for (let n = 1; n <= KINDS.length; n++) {
    if (n > 1) {
      await admin.from("hunt_players").update({ ...LOCKED, guess_n: n }).eq("hunt_id", huntId).eq("user_id", id);
      await page.evaluate(() => window.dispatchEvent(new Event("loota:hunt-changed")));
      await wait(2000);
    }
    let opened = false;
    for (let i = 0; i < 30 && !opened; i++) {
      await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Hunt"] button')].find((b) => b.textContent?.trim() === "Search here")?.click());
      await wait(1500);
      opened = await page.evaluate((s) => !!document.querySelector(`${s} [data-question], ${s} input`), IN);
    }
    const t = await attempt();
    const text = (await page.evaluate((s) => document.querySelector(s)?.innerText ?? "", IN)) ?? "";
    check(`stop ${n}: the chest opens a ${KINDS[n - 1]} puzzle`, opened && t?.kind === KINDS[n - 1] && !!t?.solution, text.split("\n").slice(0, 3).join(" | "));
    if (!t?.solution) break;
    await wait(800);
    await shot(`${n}-${t.kind}-open`);
    if (t.kind === "grammar" || t.kind === "flags" || t.kind === "brands") {
      if (t.kind !== "grammar") {
        // Pictures, loaded, from files whose names don't say whose they are
        const pics = await page.evaluate((s) => [...document.querySelectorAll(`${s} img`)].map((im) => ({ ok: im.complete && im.naturalWidth > 0, src: im.getAttribute("src") ?? "", alt: im.alt })), IN);
        check(`…${t.kind === "flags" ? "the flags" : "the logos"}: pictures, their names hidden`, pics.length === 3 && pics.every((p) => p.ok && /^\/(flags|logos)\/[0-9a-f]{12}\.svg$/.test(p.src) && /^Picture \d$/.test(p.alt)), JSON.stringify(pics));
      }
      for (let q = 0; q < t.solution.length; q++) {
        await page.evaluate((s, qq, a) => document.querySelectorAll(`${s} [data-question="${qq}"] button`)[a]?.click(), IN, q, t.solution[q]);
        await wait(150);
      }
      check(`…${t.kind}: an answer to each, checked with the button`, await button("Check"));
    } else if (t.kind === "algebra") {
      const inputs = await page.$$(`${IN} input[aria-label^="x in"]`);
      for (let q = 0; q < inputs.length; q++) await inputs[q].type(String(t.solution[q]));
      check("…algebra: x typed for each, checked with the button", inputs.length === 3 && (await button("Check")));
    } else if (t.kind === "countries") {
      // As people type them: one in lower case
      for (let q = 0; q < t.solution.length; q++) await page.type(`${IN} input[aria-label="Country ${q + 1}"]`, q === 0 ? t.solution[q].toLowerCase() : t.solution[q]);
      await wait(300);
      const ticks = await page.evaluate((s) => [...document.querySelectorAll(`${s} input[aria-label^="Country"]`)].filter((x) => x.className.includes("1E9E62")).length, IN);
      check(`…the countries (${t.puzzle.letter}): each recognised as typed, checked`, ticks === 5 && (await button("Check")), `${ticks} recognised`);
    }
    await wait(400);
    await shot(`${n}-${t.kind}-solved`);
    let won = null;
    for (let i = 0; i < 40 && !won; i++) { // up to 20 s: finishing the hunt takes longer than a key
      await wait(500);
      won = await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Key Trial result"]')?.innerText ?? null);
    }
    const expect = n === KINDS.length ? /complete|won|finished/i : new RegExp(`Key ${n} earned`, "i");
    const seen = won ?? (await page.evaluate((s) => document.querySelector(s)?.innerText ?? document.body.innerText, IN)).slice(0, 300);
    check(`…solved: ${n === KINDS.length ? "the hunt is finished" : `Key ${n} earned`}`, expect.test(won ?? ""), seen.split("\n").filter(Boolean).slice(0, 6).join(" | "));
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Key Trial result"] button')].at(-1)?.click());
    await wait(1500);
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Story"] button')].find((b) => b.textContent?.includes("Skip"))?.click());
    await wait(1500);
  }
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_bonuses").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  await admin.from("road_events").delete().eq("npc", "Probe").is("hunt_id", null).eq("user_id", id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
