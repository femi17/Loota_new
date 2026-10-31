// The penalties in the admin (owner, 31 Oct 2026): /admin/penalties lists them with counts, filters by kind and cost,
// searches the words, edits one (its words, amount, scene, in play) and adds a new one. The edited penalty is put back
// as it was, the added one removed, the test owner deleted.   SHOTS=<folder> node scripts/tests/penalties-admin-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null, browser, original = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const CODE = "s-026"; // "The goat"

try {
  const { data: o } = await admin.from("penalties").select("*").eq("code", CODE).single();
  original = o;
  const email = `pen-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ is_admin: true, home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));

  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });
  check("the admin links to the penalties", !!(await page.$('a[href="/admin/penalties"]')));
  await page.goto("http://localhost:3000/admin/penalties", { waitUntil: "networkidle2", timeout: 120000 });
  const top = await page.evaluate(() => document.querySelector("main section p")?.textContent ?? "");
  check("the counts: deep, soft, retired", /\d+ deep .* \d+ soft .* \d+ retired/.test(top), top.slice(0, 120));
  const shown = await page.evaluate(() => document.querySelectorAll('[aria-label="Penalties"] > li[data-penalty]').length);
  check("a page of them (40)", shown === 40, `${shown}`);
  await page.screenshot({ path: `${OUT}/penalties-1-list.png` });

  await page.goto("http://localhost:3000/admin/penalties?tier=deep&effect=coins", { waitUntil: "networkidle2" });
  const filtered = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Penalties"] > li[data-penalty]')].map((li) => li.querySelector("p")?.textContent ?? ""));
  check("filtered: deep coin penalties only", filtered.length > 0 && filtered.every((t) => /^Deep · wrong place · Coins/i.test(t)), `${filtered.length}, e.g. ${filtered[0]}`);
  await page.goto("http://localhost:3000/admin/penalties?q=goat", { waitUntil: "networkidle2" });
  const goats = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Penalties"] > li[data-penalty]')].map((li) => li.textContent));
  check("search: the goat", goats.length > 0 && goats.every((t) => /goat/i.test(t)), `${goats.length}`);

  // Edit one
  await page.evaluate((code) => document.querySelector(`li[data-penalty="${code}"] details`)?.setAttribute("open", ""), CODE);
  await page.evaluate((code) => {
    const f = document.querySelector(`li[data-penalty="${code}"] form`);
    f.querySelector('[name="title"]').value = "The very angry goat";
    f.querySelector('[name="amount"]').value = "75";
    f.querySelector('[name="scene"]').value = "boulder";
  }, CODE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.evaluate((code) => document.querySelector(`li[data-penalty="${code}"] form button[type="submit"]`).click(), CODE)]);
  const { data: edited } = await admin.from("penalties").select("title, amount, scene, active").eq("code", CODE).single();
  check("edited: title, amount and scene saved", edited.title === "The very angry goat" && edited.amount === 75 && edited.scene === "boulder" && edited.active, JSON.stringify(edited));
  check("…and the page says so", (await page.evaluate(() => document.body.innerText)).includes("Saved: The very angry goat"));

  // Add one
  await page.goto("http://localhost:3000/admin/penalties", { waitUntil: "networkidle2" });
  await page.evaluate(() => {
    const f = [...document.querySelectorAll("form")].find((x) => x.querySelector('button[type="submit"]')?.textContent?.includes("Add the penalty"));
    f.querySelector('[name="tier"]').value = "soft";
    f.querySelector('[name="effect"]').value = "coins";
    f.querySelector('[name="amount"]').value = "12";
    f.querySelector('[name="scene"]').value = "snake";
    f.querySelector('[name="title"]').value = "Test penalty (automated)";
    f.querySelector('[name="body"]').value = "A test snake in a test basket. You lose 12 coins.";
  });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Add the penalty")).click())]);
  const { data: added } = await admin.from("penalties").select("code, tier, effect, amount, scene, active").eq("title", "Test penalty (automated)");
  check("added: a new soft coins penalty, in play", added?.length === 1 && added[0].tier === "soft" && added[0].effect === "coins" && added[0].amount === 12 && added[0].active && added[0].code.startsWith("own-"), JSON.stringify(added));
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (original) await admin.from("penalties").update({ title: original.title, amount: original.amount, scene: original.scene, body: original.body, active: original.active }).eq("code", CODE);
  await admin.from("penalties").delete().eq("title", "Test penalty (automated)");
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`penalty put back, test penalty and owner deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
