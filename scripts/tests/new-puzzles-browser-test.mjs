// The Key Trial puzzles added on 1 Nov 2026 on a phone (owner: "lets include these puzzles, for the sudoku, we can
// half solved it"): a throwaway hunt with a Sudoku, a Threads, a Plots, a Patchwork and a Lost Vowels key at one spot.
// At each chest the board opens; the test solves it like a player (taps, drags, typing; the answer read from the
// database) and the key is won. Screenshots of each board. The hunt and test player are deleted.
//   SHOTS=<folder> node scripts/tests/new-puzzles-browser-test.mjs
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
const KINDS = ["sudoku", "threads", "plots", "patchwork", "vowels"];

try {
  const email = `puzzle-new-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    // A story hunt (no Masquerade scenes between keys to cover the boards)
    .insert({ title: "New puzzles test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true, story_status: "ready",
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
  const shot = (name) => page.screenshot({ path: `${OUT}/puzzle-new-${name}.png` });
  const IN = '[role="dialog"][aria-label="Key Trial"]';
  const centre = (sel) => page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, sel);
  const tap = async (sel) => {
    const pt = await centre(sel);
    if (pt) await page.mouse.click(pt.x, pt.y);
    return !!pt;
  };
  const cell = (i) => `${IN} [data-cell="${i}"]`;
  const button = (text) => page.evaluate((t, s) => {
    const b = [...document.querySelectorAll(`${s} button`)].find((x) => x.textContent?.trim().startsWith(t));
    b?.click();
    return !!b;
  }, text, IN);
  const drag = async (cells) => {
    const first = await centre(cell(cells[0]));
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const k of cells.slice(1)) {
      const pt = await centre(cell(k));
      await page.mouse.move(pt.x, pt.y, { steps: 3 });
    }
    await page.mouse.up();
  };
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
      opened = await page.evaluate((s) => !!document.querySelector(`${s} [data-cell], ${s} input`), IN);
    }
    const t = await attempt();
    const text = (await page.evaluate((s) => document.querySelector(s)?.innerText ?? "", IN)) ?? "";
    check(`stop ${n}: the chest opens a ${KINDS[n - 1]} puzzle`, opened && t?.kind === KINDS[n - 1] && !!t?.solution, text.split("\n").slice(0, 3).join(" | "));
    if (!t?.solution) break;
    await wait(600);
    await shot(`${n}-${t.kind}-open`);
    const p = t.puzzle;
    if (t.kind === "sudoku") {
      for (let i = 0; i < 81; i++) {
        if (p.given[i]) continue;
        await tap(cell(i));
        await tap(`${IN} [aria-label="Number ${t.solution[i]}"]`);
      }
    } else if (t.kind === "threads") {
      for (const thread of t.solution) await drag(thread);
    } else if (t.kind === "plots") {
      for (const [top, left, bottom, right] of t.solution) await drag([top * p.n + left, bottom * p.n + right]);
    } else if (t.kind === "patchwork") {
      for (const x of t.solution) {
        await tap(`${IN} [aria-label="Patch ${x.piece + 1}"]`);
        for (let k = 0; k < x.turns; k++) await button("↻ Turn");
        await tap(cell(x.r * p.n + x.c));
      }
    } else if (t.kind === "vowels") {
      for (let i = 0; i < t.solution.length; i++) await page.type(`${IN} input[aria-label="Word ${i + 1}"]`, t.solution[i].toLowerCase());
      check("…Lost Vowels: checked with the button", await button("Check the words"));
    }
    await wait(400);
    await shot(`${n}-${t.kind}-solved`);
    let won = null;
    for (let i = 0; i < 20 && !won; i++) {
      await wait(500);
      won = await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Key Trial result"]')?.innerText ?? null);
    }
    const expect = n === KINDS.length ? /complete|won|finished/i : new RegExp(`Key ${n} earned`, "i");
    check(`…solved: ${n === KINDS.length ? "the hunt is finished" : `Key ${n} earned`}`, expect.test(won ?? ""), (won ?? "").split("\n").filter(Boolean).slice(0, 3).join(" | "));
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
