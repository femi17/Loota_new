// Worldwide or Nigeria (owner, 7 Nov 2026: "The hunt creation should have the option of worldwide and Nigeria"): a
// throwaway owner makes the next story hunt with Where = Nigeria. The hunt is saved as a Nigeria hunt, its card says so,
// and the request to copy ends in "Nigeria". The test hunt and owner are deleted (the day is free again).
//   SHOTS=<folder> node scripts/tests/hunt-region-browser-test.mjs
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
let browser, id = null, huntId = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  const email = `regiontest-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ is_admin: true, home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });

  const select = await page.$('select[name="region"]');
  if (!select) {
    check("the new-hunt form is there (the next day may already have its hunt)", false);
  } else {
    const options = await page.evaluate(() => [...document.querySelectorAll('select[name="region"] option')].map((o) => o.textContent?.trim()));
    check("new hunt: Where offers Worldwide and Nigeria", options.some((o) => /Worldwide/.test(o)) && options.some((o) => /Nigeria/.test(o)), options.join(" / "));
    await page.select('select[name="region"]', "nigeria");
    await page.type('input[name="prize"]', "Region test prize");
    const since = new Date().toISOString();
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 120000 }), page.evaluate(() => document.querySelector('select[name="region"]')?.closest("form")?.requestSubmit())]);
    const { data: h } = await admin.from("hunts").select("id, region, story_status").eq("created_by", id).gte("created_at", since).maybeSingle();
    huntId = h?.id ?? null;
    check("saved as a Nigeria hunt, waiting for its story", h?.region === "nigeria" && h?.story_status === "waiting", JSON.stringify(h));
    const card = await page.evaluate(() => document.querySelector('[aria-label="Waiting for its story"]')?.textContent ?? "");
    check("its card asks for a Nigeria story", /new-story-hunt [0-9a-f-]{36} \d+ keys Nigeria/.test(card) && /every one in Nigeria/.test(card), card.slice(0, 200));
    check("…and the hunt line says so", await page.evaluate(() => /keys in Nigeria/.test(document.body.textContent ?? "")));
    await page.screenshot({ path: `${OUT}/hunt-region.png` });
  }
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test hunt and owner deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
