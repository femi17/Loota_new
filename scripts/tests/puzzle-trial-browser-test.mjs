// Key Trial puzzles on the phone (owner, 24 Oct 2026): a throwaway hunt with a Sentries, a Route and an Adire key at one
// spot. At each chest the puzzle board opens; the test solves it by tapping like a player (the answer read from the
// database), and the key is won. Screenshots of each board. The hunt and test player are deleted.
//   SHOTS=<folder> node scripts/tests/puzzle-trial-browser-test.mjs
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
const spot = { lng: 3.378214, lat: 6.500147 }; // on a road in Yaba

try {
  const email = `puzzle-ui-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Puzzle UI test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  const key = (n, trial_kind, relay = false) => ({ hunt_id: huntId, n, relay, riddle: `Test stop ${n}.`, category: "maths", trial_kind, area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, spot_lng: spot.lng, spot_lat: spot.lat });
  // Six stops: the first three at level 1 (warnings), the last three harder; stop 2 is a relay chest (a clue, not a key).
  await admin.from("hunt_keys").insert([key(1, "sentries"), key(2, "route", true), key(3, "adire"), key(4, "sentries"), key(5, "route"), key(6, "adire")]);
  const expect = ["Key 1 earned", "No key", "Key 2 earned", "Key 3 earned", "Key 4 earned", "complete|won"];
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  // No road events in this test.
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
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
    } catch {}
  }, huntId, id);
  const shot = (name) => page.screenshot({ path: `${OUT}/puzzle-${name}.png` });
  const dialog = () => page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Key Trial"]')?.innerText ?? null);
  /** Click a square's centre (like a finger tap). */
  const tapCell = async (i) => {
    const box = await page.evaluate((k) => {
      const el = document.querySelector(`[role="dialog"][aria-label="Key Trial"] [data-cell="${k}"]`);
      const r = el?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, i);
    if (box) await page.mouse.click(box.x, box.y);
    return !!box;
  };
  const attempt = async () => (await admin.from("trial_attempts").select("id, kind, solution, puzzle").eq("hunt_id", huntId).eq("user_id", id).eq("status", "active").maybeSingle()).data;

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);

  for (let n = 1; n <= 6; n++) {
    // Search here, at the spot: the chest opens a puzzle.
    let opened = false;
    for (let i = 0; i < 30 && !opened; i++) {
      await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Hunt"] button')].find((b) => b.textContent?.trim() === "Search here")?.click());
      await wait(1500);
      opened = await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Key Trial"] [data-cell]'));
    }
    const t = await attempt();
    const text = (await dialog()) ?? "";
    check(`stop ${n}: the chest opens a ${t?.kind ?? "?"} puzzle board`, opened && !!t?.solution, text.split("\n").slice(0, 3).join(" | "));
    if (!t?.solution) break;
    await wait(600);
    await shot(`${n}-${t.kind}-open`);
    const p = t.puzzle;
    if (t.kind === "sentries") {
      for (const [row, col] of t.solution.map((cc, r) => [r, cc])) {
        await tapCell(row * p.n + col);
        await tapCell(row * p.n + col);
      }
    } else if (t.kind === "route") {
      // Drag through the squares, as a finger would.
      const centre = async (k) => page.evaluate((i) => {
        const r = document.querySelector(`[role="dialog"][aria-label="Key Trial"] [data-cell="${i}"]`).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, k);
      const first = await centre(t.solution[0]);
      await page.mouse.move(first.x, first.y);
      await page.mouse.down();
      for (const cell of t.solution.slice(1)) {
        const pt = await centre(cell);
        await page.mouse.move(pt.x, pt.y, { steps: 3 });
      }
      await page.mouse.up();
    } else {
      for (let i = 0; i < t.solution.length; i++) {
        if (p.given[i] !== undefined) continue;
        await tapCell(i); // indigo
        if (t.solution[i] === 0) await tapCell(i); // white
      }
      check("…Adire: checked with the button", await page.evaluate(() => {
        const b = [...document.querySelectorAll('[role="dialog"][aria-label="Key Trial"] button')].find((x) => x.textContent?.includes("Check the cloth"));
        b?.click();
        return !!b;
      }));
    }
    await wait(400);
    await shot(`${n}-${t.kind}-solved`);
    let won = null;
    for (let i = 0; i < 20 && !won; i++) {
      await wait(500);
      won = await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Key Trial result"]')?.innerText ?? null);
    }
    check(`…solved: ${expect[n - 1]}`, new RegExp(expect[n - 1], "i").test(won ?? ""), (won ?? "").split("\n").filter(Boolean).slice(0, 3).join(" | "));
    if (n === 2) await shot("2-relay-card");
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Key Trial result"] button')].at(-1)?.click());
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
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
