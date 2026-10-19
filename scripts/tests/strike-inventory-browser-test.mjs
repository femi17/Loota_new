// The inventory's new look, and the strike (owner, 19 Oct 2026: "a thunder strike on the screen… a tool spinning out
// till it goes out of the way… think of Mario Kart"), on a phone: the inventory's tabs (gear with its icons, relics,
// Wonders) and no visible scrollbar; using a Rain Charm from it strikes (the flash, the bolt, the item spinning off,
// and on the map the item flying away); another player's Rain Charm reaching you strikes too. The players are deleted.
//   SHOTS=<folder> node scripts/tests/strike-inventory-browser-test.mjs
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
const soon = (d) => new Date(Date.now() + d * 86400e3).toISOString();
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 };

async function player(tag) {
  const email = `strike-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", data.user.id);
  await admin.from("player_positions").upsert({ user_id: data.user.id, lng: start.lng, lat: start.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  return { id: data.user.id, email, password };
}

try {
  const me = await player("me");
  const other = await player("other");
  await admin.rpc("apply_coin_change", { p_user: me.id, p_amount: 300, p_kind: "admin", p_reason: "Strike test" });
  await admin.from("player_vehicles").insert({ user_id: me.id, kind: "motorbike", fuel: 70, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: false, helmet: true });
  await admin.from("player_relics").insert([
    { user_id: me.id, relic: "rain_charm", charges: 1, expires_at: soon(5) },
    { user_id: me.id, relic: "second_wind", charges: 2, expires_at: soon(3) },
    { user_id: other.id, relic: "rain_charm", charges: 1, expires_at: soon(5) },
  ]);

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: me.email, password: me.password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const shot = (name) => page.screenshot({ path: `${OUT}/strike-${name}.png` });
  const dialog = () => page.evaluate((nl) => document.querySelector('[role="dialog"][aria-label="Inventory"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const tab = (name) => page.evaluate((n) => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.includes(n))?.click(), name);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(18000);

  // ---- The inventory
  await page.evaluate(() => document.querySelector('button[aria-label^="Inventory"]')?.click());
  await wait(1500);
  const gear = await dialog();
  check(
    "the inventory opens on Gear: tabs with counts, the motorbike card, its gear as tiles",
    /Gear \| 💎 \| Relics \| 3/.test(gear ?? "") && /Motorbike/.test(gear ?? "") && /Helmet \| ✓ Got it/.test(gear ?? "") && /Rider's licence \| \+ Buy · 150 coins/.test(gear ?? ""),
    gear?.slice(0, 300),
  );
  check("…and the jerry can card", /Jerry can/.test(gear ?? "") && /petrol stations sell them/.test(gear ?? ""));
  const bars = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="dialog"][aria-label="Inventory"] *')].find((e) => getComputedStyle(e).overflowY === "auto");
    return el ? { width: getComputedStyle(el).scrollbarWidth, gutter: el.offsetWidth - el.clientWidth } : null;
  });
  check("no visible scrollbar", bars?.width === "none" && bars.gutter === 0, JSON.stringify(bars));
  await shot("1-gear");
  await tab("Relics");
  await wait(800);
  const relics = await dialog();
  check("Relics: the Rain Charm and Second Wind ×2, with rarity and days left", /Rain Charm/.test(relics ?? "") && /Second Wind/.test(relics ?? "") && /×2/.test(relics ?? "") && /days left/.test(relics ?? ""), relics?.slice(0, 200));
  await shot("2-relics");
  await tab("Wonders");
  await wait(500);
  check("Wonders: none yet, the Djinn's Wager explained", /No Wonders/.test((await dialog()) ?? ""));
  await shot("3-wonders");

  // ---- Using the Rain Charm: the strike
  await tab("Relics");
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Inventory"] button')].find((b) => b.textContent?.trim() === "Use")?.click());
  let struck = false;
  for (let i = 0; i < 20 && !struck; i++) {
    await wait(150);
    struck = await page.evaluate(() => !!document.querySelector("[data-strike]"));
  }
  check("using a Rain Charm: the strike (flash, bolt, the item spinning off)", struck);
  await wait(150);
  await shot("4-strike");
  await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Inventory"] button[aria-label="Close"]')?.click());
  await wait(700);
  await shot("5-flying");
  await wait(2500);
  check("…and it's gone", !(await page.evaluate(() => !!document.querySelector("[data-strike]"))));

  // ---- Someone else's Rain Charm reaching you
  await wait(1500);
  const oc = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await oc.auth.signInWithPassword({ email: other.email, password: other.password });
  const used = (await oc.rpc("use_relic", { p_relic: (await admin.from("player_relics").select("id").eq("user_id", other.id).single()).data.id })).data;
  check("another player uses a Rain Charm nearby", used?.ok === true, JSON.stringify(used));
  let theirs = false;
  for (let i = 0; i < 60 && !theirs; i++) {
    await wait(500);
    theirs = await page.evaluate(() => !!document.querySelector("[data-strike]"));
  }
  check("…it reaches you: a strike", theirs);
  await wait(500);
  await shot("6-theirs");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
