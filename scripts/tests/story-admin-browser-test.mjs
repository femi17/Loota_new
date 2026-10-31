// The story in /admin (owner, 24 Oct 2026: the Masquerade, light and playful): a draft hunt of three stops (Key 1, a
// relay chest, Key 2); "The story" lists its beats (start, after Key 1, the relay, the finish); "Draft the story with
// Claude" fills them with the Masquerade's and the Keeper's lines; saving keeps them. A throwaway admin and hunt,
// deleted after. Calls Claude (about a cent).
//   SHOTS=<folder> node scripts/tests/story-admin-browser-test.mjs
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
let id = null, huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const at = { lng: 3.378214, lat: 6.500147 };

try {
  const email = `story-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ is_admin: true, home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Story test (automated)", prize: "A golden mask", winners: 1, starts_at: new Date(Date.now() + 86400e3).toISOString(), ends_at: new Date(Date.now() + 2 * 86400e3).toISOString(), published: false })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  const stop = (n, relay) => ({ hunt_id: huntId, n, relay, riddle: `Stop ${n}.`, category: "maths", area_lng: at.lng, area_lat: at.lat, area_radius_m: 500, spot_lng: at.lng, spot_lat: at.lat });
  await admin.from("hunt_keys").insert([stop(1, false), stop(2, true), stop(3, false)]);

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });

  // This hunt's story (the page lists every hunt's).
  const mine = `details:has(input[name="hunt"][value="${huntId}"]):not(:has(details))`; // the story box itself, not the folding list of hunts round it
  const opened = await page.evaluate((sel) => {
    const d = document.querySelector(sel);
    if (d) d.open = true;
    return d ? [...d.querySelectorAll("textarea")].map((t) => t.name) : null;
  }, mine);
  check("the story's beats: the start, after Key 1, the relay, the finish", JSON.stringify(opened) === JSON.stringify(["beat:start", "beat:key:1", "beat:relay:2", "beat:finish"]), JSON.stringify(opened));
  await page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)].find((b) => b.textContent?.includes("Draft the story with Claude"))?.click(), mine);
  let filled = [];
  for (let i = 0; i < 120; i++) {
    await wait(1000);
    filled = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} textarea`)].map((t) => t.value), mine);
    if (filled.every((v) => v.trim().length > 0)) break;
  }
  check("Claude drafted every beat", filled.length === 4 && filled.every((v) => /^(Masquerade|Keeper|Narrator): /m.test(v)), filled.map((v) => v.split("\n")[0]).join(" / "));
  check("…with the Masquerade in it", filled.some((v) => /^Masquerade: /m.test(v)));
  console.log(`  start: ${filled[0]?.split("\n").join(" | ")}`);
  await page.screenshot({ path: `${OUT}/story-admin.png`, fullPage: true });
  await page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)].find((b) => b.textContent?.trim() === "Save the story")?.click(), mine);
  await wait(4000);
  const { data: rows } = await admin.from("hunt_story").select("beat, lines").eq("hunt_id", huntId);
  check("saved: four beats", rows?.length === 4, (rows ?? []).map((r) => `${r.beat}:${r.lines.length}`).join(", "));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_story").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test admin deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
