// The lobby, "play first" (owner, 7 Nov 2026: "we need to redesign the lobby… the free roam when there is no hunt should
// be at the top"): a player in no live hunt sees Free roam as the first card; once in a live hunt (one key found), that
// hunt is the first card ("Key 2 of 3", Continue the hunt) with Free roam as a row under it. Fits a phone. A throwaway
// hunt and the test player are deleted.
//   SHOTS=<folder> node scripts/tests/lobby-browser-test.mjs
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
let id = null, hunt = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const spot = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `lobby-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
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
  const look = () => page.evaluate(() => {
    const main = document.querySelector("main");
    const first = main?.querySelector(":scope > section:nth-of-type(2)");
    return {
      first: first?.getAttribute("aria-label") ?? "",
      firstText: first?.textContent ?? "",
      play: first?.querySelector('a[href^="/play"]')?.getAttribute("href") ?? "",
      roamRow: [...(main?.querySelectorAll(":scope > a[href='/play']") ?? [])].map((a) => a.textContent).join(" | "),
      hunts: [...document.querySelectorAll('section[aria-label="Hunts"] article h3')].map((h) => h.textContent),
      wide: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  // 1. In no hunt: Free roam first
  await page.goto("http://localhost:3000/lobby", { waitUntil: "networkidle2", timeout: 120000 });
  const before = await look();
  check("not in a hunt: the first card is Free roam, with Play free roam", before.first === "Free roam" && /Play free roam/.test(before.firstText) && before.play === "/play", `${before.first}: ${before.play}`);
  check("…the live hunts below it, to join", before.hunts.length >= 1, before.hunts.join(" | "));
  check("…fits a phone (no sideways scroll)", !before.wide);
  await page.screenshot({ path: `${OUT}/lobby-1-free-roam.png`, fullPage: true });

  // 2. In a live hunt with one key: that hunt first
  const { data: h, error } = await admin.from("hunts").insert({ title: "Lobby test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 86400e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  hunt = h.id;
  for (const n of [1, 2, 3]) {
    const { error: e } = await admin.from("hunt_keys").insert({ hunt_id: hunt, n, riddle: "Where?", category: "general", trial_kind: "puzzle", area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 1500, spot_lng: spot.lng, spot_lat: spot.lat, exact_m: 300 });
    if (e) throw e;
  }
  await admin.from("hunt_players").insert({ hunt_id: hunt, user_id: id, keys_held: 1 });
  await page.goto("http://localhost:3000/lobby", { waitUntil: "networkidle2", timeout: 120000 });
  const after = await look();
  check("in a live hunt: the first card is that hunt, with Continue the hunt", after.first === "Your hunt" && /Lobby test \(automated\)/.test(after.firstText) && /Continue the hunt/.test(after.firstText) && after.play === `/play?hunt=${hunt}`, `${after.first}: ${after.play}`);
  check("…where you are in it (Key 2 of 3)", /Key 2 of 3/.test(after.firstText), after.firstText.slice(0, 160));
  check("…Free roam as a row under it", /Free roam/.test(after.roamRow), after.roamRow);
  check("…and your hunt isn't listed again below", !after.hunts.includes("Lobby test (automated)"), after.hunts.join(" | "));
  check("…fits a phone", !after.wide);
  await page.screenshot({ path: `${OUT}/lobby-2-in-hunt.png`, fullPage: true });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (hunt) await admin.from("hunts").delete().eq("id", hunt);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
