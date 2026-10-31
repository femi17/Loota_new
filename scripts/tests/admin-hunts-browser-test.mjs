// The admin's hunt list (owner, 31 Oct 2026: "work on the admin, and remove all hunts we do not need"). Two throwaway
// hunts: one live, one finished. The list groups them (Live now / Finished, finished folded away); the live one has no
// Delete; the finished one's Delete asks for DELETE to be typed (the button stays off until then), then the hunt is gone
// from the database. The Djinn box shows the real state. The test hunts and owner are deleted.
//   SHOTS=<folder> node scripts/tests/admin-hunts-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
let browser, id = null;
const huntIds = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const email = `admintest-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ is_admin: true, home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  const make = async (title, starts, ends, published) => {
    const { data: h, error } = await admin.from("hunts")
      .insert({ title, prize: "none", winners: 1, starts_at: starts, ends_at: ends, published, all_day: true, questions_per_trial: 2, seconds_per_question: 12, created_by: id })
      .select("id").single();
    if (error) throw error;
    huntIds.push(h.id);
    await admin.from("hunt_keys").insert({ hunt_id: h.id, n: 1, riddle: "Test riddle.", category: "maths", area_lng: 3.5, area_lat: 6.6, area_radius_m: 800, spot_lng: 3.5, spot_lat: 6.6 });
    return h.id;
  };
  const live = await make("Admin test LIVE (automated)", ago(600), soon(3600), true);
  const done = await make("Admin test FINISHED (automated)", ago(7200), ago(3600), true);

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000 });
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });

  const section = (title) => page.evaluate((t) => {
    const h = [...document.querySelectorAll("section h2")].find((x) => x.textContent === t);
    const s = h?.closest("section");
    const group = h?.closest("details")?.querySelector("summary")?.textContent ?? "";
    return s ? { group, text: s.textContent ?? "", deletable: [...s.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Delete") } : null;
  }, title);
  const l = await section("Admin test LIVE (automated)");
  const f = await section("Admin test FINISHED (automated)");
  check("the live hunt is under Live now, marked live", !!l && /Live now/.test(l.group) && /● Live/.test(l.text), l?.group);
  check("…and can't be deleted", !!l && !l.deletable);
  check("the finished hunt is under Finished", !!f && /Finished/.test(f.group), f?.group);
  check("…folded away at first", await page.evaluate(() => [...document.querySelectorAll("details")].some((d) => /Finished/.test(d.querySelector("summary")?.textContent ?? "") && !d.open)));
  const djinn = await page.evaluate(() => [...document.querySelectorAll("section")].find((s) => /Djinn/.test(s.querySelector("h2")?.textContent ?? ""))?.textContent ?? "");
  check("the Djinn box says what's on (no more 'off until the chambers are built')", !/off until the chambers/.test(djinn) && /(A Wager is on now|No Wager on)/.test(djinn), djinn.slice(0, 120));
  await page.screenshot({ path: `${OUT}/admin-1-list.png`, fullPage: false });

  // Delete the finished one: open the list, press Delete, the button waits for DELETE
  await page.evaluate(() => [...document.querySelectorAll("details")].forEach((d) => { if (/Finished/.test(d.querySelector("summary")?.textContent ?? "")) d.open = true; }));
  await page.evaluate((t) => {
    const s = [...document.querySelectorAll("section h2")].find((x) => x.textContent === t)?.closest("section");
    [...(s?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "Delete")?.click();
  }, "Admin test FINISHED (automated)");
  await wait(400);
  const off = await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete for good")?.disabled);
  check("Delete asks for DELETE first (the button is off)", off === true);
  await page.type('input[aria-label="Type DELETE to confirm"]', "delete");
  await page.screenshot({ path: `${OUT}/admin-2-confirm.png` });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {}), page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete for good")?.click())]);
  await wait(1500);
  const { data: gone } = await admin.from("hunts").select("id").eq("id", done);
  check("…typed: the finished hunt is gone from the database", (gone ?? []).length === 0);
  check("…and the page says so", /deleted/.test(await page.evaluate(() => document.body.innerText)));
  const { data: still } = await admin.from("hunts").select("id").eq("id", live);
  check("the live hunt is still there", (still ?? []).length === 1);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const h of huntIds) await admin.from("hunts").delete().eq("id", h);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test hunts and owner deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
