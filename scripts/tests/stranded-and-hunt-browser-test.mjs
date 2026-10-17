// Two fixes in the browser: (1) a hunter put on a cut-off pocket of road (Lagos airport's paths) is
// moved onto the proper road and can walk away; (2) the hunt panel can be hidden, stays hidden after a
// reload, and comes back from the lobby's "Continue the hunt". The test player is deleted.
//   node scripts/tests/stranded-and-hunt-browser-test.mjs
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
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
const ids = [];
let browser;
try {
  const stranded = { lng: 3.32047070315613, lat: 6.57888821987897 }; // on the airport's cut-off paths
  const email = `stranded-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ username: `Lost_${Date.now() % 1000}`, home_lng: stranded.lng, home_lat: stranded.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: stranded.lng, lat: stranded.lat, mode: "walk", updated_at: new Date(Date.now() - 3600_000).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const { data: hunts } = await c.rpc("list_hunts");
  const hunt = (hunts ?? []).find((h) => h.phase === "live" || h.phase === "upcoming");
  if (hunt) await c.rpc("join_hunt", { p_hunt: hunt.id });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const open = async (path = "/play") => {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(20000);
  };
  const pos = async () => (await admin.from("player_positions").select("lng, lat").eq("user_id", id).single()).data;

  // ---- (1) Stranded on the airport's paths
  await open();
  const placed = await pos();
  console.log(`placed: ${Math.round(metres(placed, stranded))} m from the stranded spot`);
  await page.keyboard.down("ArrowUp");
  await wait(5000);
  await page.keyboard.up("ArrowUp");
  await wait(4000);
  const walked = await pos();
  console.log(`walked: ${Math.round(metres(walked, placed))} m in 5 s (straight-line from where they started), now ${Math.round(metres(walked, stranded))} m from the stranded spot`);
  await page.screenshot({ path: `${OUT}/stranded-after.png` });

  // ---- (2) Hiding the hunt
  if (!hunt) console.log("no live or upcoming hunt to join: hunt checks skipped");
  else {
    const panel = () => page.evaluate(() => !!document.querySelector('section[aria-label="Hunt"]'));
    console.log("hunt panel shown:", await panel());
    await page.evaluate(() => document.querySelector('button[aria-label^="Hide the hunt"]')?.click());
    await wait(800);
    console.log("after hiding:", await panel());
    await open();
    console.log("after a reload:", await panel());
    await open(`/play?hunt=${hunt.id}`);
    console.log("from the lobby's Continue the hunt:", await panel());
    await open();
    console.log("and after that, a plain reload:", await panel());
  }
  console.log("browser errors:", problems.length ? problems.join(" | ") : "none");
} catch (e) {
  console.log("ERROR", e.message);
} finally {
  await browser?.close().catch(() => {});
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log("test players deleted:", ids.length);
}
