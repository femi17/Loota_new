// The Djinn's chamber in the browser (phone): a trap springs on the approach, the chamber's button at the
// place, wrong answers and the whirlwind. Plays a decoy seal of the Wager that's on (never wins it);
// the test player is deleted.   SHOTS=<folder> node scripts/tests/djinn-chamber-browser-test.mjs
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
const k = (lat) => Math.cos((lat * Math.PI) / 180);
const around = (p, arc, m) => {
  const a = (arc * 45 * Math.PI) / 180;
  return { lng: p.lng + (Math.sin(a) * m) / (111320 * k(p.lat)), lat: p.lat + (Math.cos(a) * m) / 110574 };
};
const ids = [];
let browser;
try {
  const { data: live } = await admin.from("djinn_wagers").select("*").gt("ends_at", new Date().toISOString()).is("winner", null).limit(1);
  const w = live?.[0];
  if (!w) throw new Error("No Wager is on: summon one from /admin first");
  // A decoy seal (so the test never wins the Wager): the first one that isn't real.
  const { data: site } = await admin.from("djinn_sites").select("*").eq("id", w.site_ids.find((x) => x !== w.real_site)).single();

  const email = `chamber-b-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  await admin.from("profiles").update({ username: `Raider_${Date.now() % 1000}`, home_lng: site.lng, home_lat: site.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  // Through the gate already, with the seal broken (as if they'd played it): straight to the approach.
  await admin.from("djinn_entries").insert({ wager_id: w.id, user_id: id, gate_started_at: new Date().toISOString(), gate_deadline: new Date().toISOString(), gate_score: 3, favour: 2, chosen_site: site.id, chosen_at: new Date().toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  // The traps around this place (laid on the first approach).
  await admin.from("player_positions").upsert({ user_id: id, lng: around(site, 0, 1100).lng, lat: around(site, 0, 1100).lat, mode: "walk", energy: 90, updated_at: new Date().toISOString() });
  await c.rpc("djinn_approach");
  const { data: traps } = await admin.from("djinn_traps").select("*").eq("wager_id", w.id).eq("site_id", site.id);
  const trap = traps.find((t) => t.ring === 600 && t.kind !== "collapsing_bridge") ?? traps.find((t) => t.ring === 600);
  const inside = around(site, trap.arc, 560);
  await admin.from("player_positions").update({ lng: inside.lng, lat: inside.lat, updated_at: new Date().toISOString() }).eq("user_id", id);

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  // Everything the game says, and any trap flash, from the moment the page loads (messages fade).
  await page.evaluateOnNewDocument(() => {
    window.__said = [];
    window.__flashed = false;
    new MutationObserver(() => {
      const t = document.querySelector('p[role="status"]')?.textContent;
      if (t && window.__said.at(-1) !== t) window.__said.push(t);
      if (document.querySelector(".loota-trap-flash")) window.__flashed = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const open = async () => {
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(20000);
  };
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const hint = () => page.evaluate(() => document.querySelector('p[role="status"]')?.textContent ?? "");
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll("button")].find((y) => (y.textContent?.includes(x) || y.getAttribute("aria-label")?.includes(x)) && !y.disabled); b?.click(); return !!b; }, t);

  // ---- A trap on the way in
  console.log(`place: ${site.name}, ${site.country}; trap on the outer ring at ${trap.arc * 45}°: ${trap.kind}`);
  await open();
  const said = await page.evaluate(() => window.__said.filter((t) => /Quicksand|dart|snake|bridge/i.test(t)));
  console.log("trap:", said.join(" / ") || "(none said)", "| flash:", await page.evaluate(() => window.__flashed));
  const entry = (await admin.from("djinn_entries").select("rings_done").eq("wager_id", w.id).eq("user_id", id).single()).data;
  const at = (await admin.from("player_positions").select("lng, lat").eq("user_id", id).single()).data;
  console.log("   server: rings crossed", JSON.stringify(entry.rings_done), "| standing", Math.round(Math.hypot((at.lng - site.lng) * 111320 * k(site.lat), (at.lat - site.lat) * 110574)), "m from the place");
  await page.screenshot({ path: `${OUT}/chamber-trap.png` });

  // ---- At the place: the chamber
  await admin.from("player_positions").update({ lng: around(site, trap.arc, 15).lng, lat: around(site, trap.arc, 15).lat, updated_at: new Date().toISOString() }).eq("user_id", id);
  await open();
  const button = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent ?? "").find((t) => t.includes("Enter the chamber")) ?? null);
  console.log("chamber button:", button);
  await page.screenshot({ path: `${OUT}/chamber-door.png` });
  console.log("enter:", await clickText("Enter the chamber"));
  await wait(3000);
  console.log("chamber:", (await text('[role="dialog"][aria-label="The Djinn"]'))?.slice(0, 400));
  await page.screenshot({ path: `${OUT}/chamber-rooms.png` });

  // ---- Wrong: the whirlwind
  console.log("speak (wrong):", await clickText("Speak the final words"));
  await wait(1200);
  console.log("whirlwind showing:", await page.evaluate(() => !!document.querySelector(".loota-whirlwind-screen")), "| the Djinn:", (await text('[role="dialog"][aria-label="The Djinn"]'))?.slice(0, 200));
  await page.screenshot({ path: `${OUT}/chamber-whirlwind.png` });
  await wait(5000);
  const pos = (await admin.from("player_positions").select("lng, lat").eq("user_id", id).single()).data;
  const km = Math.hypot((pos.lng - site.lng) * 111320 * k(site.lat), (pos.lat - site.lat) * 110574) / 1000;
  console.log("after:", await hint(), `| now ${km.toFixed(0)} km from ${site.name}`);
  await page.screenshot({ path: `${OUT}/chamber-after.png` });
  console.log("browser errors:", problems.length ? problems.join(" | ") : "none");
} catch (e) {
  console.log("ERROR", e.message);
} finally {
  await browser?.close().catch(() => {});
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log("test players deleted:", ids.length);
}
