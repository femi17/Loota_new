// Gear and papers in the vehicle panel (phone): buying a bicycle comes with a light, ticked (Buy · 640); a motorbike
// lists its helmet, rider's licence and registration to buy with it. A bicycle with no light, after dark: the rider is
// told they crawl and the police may stop them, and the panel offers "+ Bicycle light · 40", which then shows ✓.
// (The night part runs only when it's dark in Lagos; otherwise it says so.) The test player is deleted.
//   SHOTS=<folder> node scripts/tests/gear-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const spot = { lng: 3.378214, lat: 6.500147 }; // Yaba

try {
  const email = `gear-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 1000, p_kind: "admin", p_reason: "Gear test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 90, updated_at: ago(30) });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const shot = (name) => page.screenshot({ path: `${OUT}/gear-${name}.png` });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const bicycle = async () => (await admin.from("player_vehicles").select("light, in_use").eq("user_id", id).eq("kind", "bicycle").maybeSingle()).data;
  const click = (sel, start) => page.evaluate((s, x) => {
    const b = [...document.querySelectorAll(`${s} button`)].find((e) => e.textContent?.trim().startsWith(x) && !e.disabled);
    b?.click();
    return !!b;
  }, sel, start);
  const open = async () => {
    await page.goto("about:blank");
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };
  const garage = async () => {
    await page.click('[data-tool="travel"]');
    await wait(1200);
  };
  const bikeCard = () => page.evaluate((nl) => {
    const g = document.querySelector('[aria-label^="Bicycle: gear and papers"]');
    return g?.parentElement?.innerText.split(nl).join(" | ") ?? null;
  }, NL);

  // ---- Buying a bicycle: the light comes ticked
  await open();
  await garage();
  const panel = await text('[aria-label="Vehicles"]');
  check("the bicycle comes with a light, ticked: Buy · 640", /Bicycle light \| ✓ 40 coins/.test(panel ?? "") && /Buy · 640 coins/.test(panel ?? ""), panel?.slice(0, 300));
  check("…a motorbike lists its helmet, rider's licence and registration", /Helmet \| ✓ 80 coins/.test(panel ?? "") && /Rider's licence \| ✓ 150 coins/.test(panel ?? "") && /Registration \(plate number\) \| ✓ 200 coins/.test(panel ?? ""));
  check("…a car its driver's licence, registration and insurance", /Driver's licence \| ✓ 300 coins/.test(panel ?? "") && /Insurance \| ✓ 250 coins/.test(panel ?? ""));
  await shot("1-panel");
  check("buy the bicycle", await click('[aria-label="Vehicles"]', "Buy · 640"));
  await wait(4000);
  let b = await bicycle();
  check("…bought with its light: 640 coins", b?.light === true && (await coins()) === 360, `${JSON.stringify(b)} · ${1000 - (await coins())}`);

  // ---- A bicycle with no light, after dark
  await admin.from("player_vehicles").update({ light: false }).eq("user_id", id).eq("kind", "bicycle");
  const { data: dark } = await admin.rpc("missing_papers", { p_user: id, p_mode: "bicycle", p_lng: spot.lng, p_lat: spot.lat });
  const night = Array.isArray(dark) && dark.includes("light");
  await admin.from("player_positions").update({ mode: "bicycle", updated_at: ago(30) }).eq("user_id", id);
  await page.goto("about:blank");
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  if (night) {
    let said = null; // (said once, as you set off, for 9 seconds)
    for (let i = 0; i < 60 && !/no light/.test(said ?? ""); i++) {
      await wait(500);
      said = await page.evaluate(() => document.body.innerText);
    }
    check("after dark with no light: told you crawl and the police may stop you", /your bicycle has no light: you ride slowly, and the police may stop you/.test(said ?? ""));
    await shot("2-dark");
  } else console.log("(daytime in Lagos: the after-dark warning not checked)");
  await wait(12000);
  await garage();
  const card = await bikeCard();
  check("the panel offers + Bicycle light · 40", /Bicycle light \| \+ Buy · 40 coins/.test(card ?? ""), card);
  check("…bought there", await page.evaluate(() => {
    const b = [...document.querySelectorAll('[aria-label="Bicycle: gear and papers"] button')].find((e) => e.textContent?.includes("Bicycle light") && !e.disabled);
    b?.click();
    return !!b;
  }));
  await wait(3000);
  b = await bicycle();
  const after = await bikeCard();
  check("…the light on the bicycle, ✓ in the panel, 40 coins", b?.light === true && /Bicycle light \| ✓ Got it/.test(after ?? "") && (await coins()) === 320, `${after} · ${await coins()}`);
  await shot("3-light");
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
