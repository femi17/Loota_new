// "Draft with Claude" on /admin (owner, 22 Oct 2026): name a key's place, get riddles from Claude, tap one and it fills
// the riddle and the Final Approach clue. A throwaway admin and draft hunt, deleted after. Calls Claude (about a cent).
//   SHOTS=<folder> node scripts/tests/riddle-draft-browser-test.mjs
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

try {
  const email = `riddle-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ is_admin: true, home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", id);
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Riddle test (automated)", prize: "none", winners: 1, starts_at: new Date(Date.now() + 86400e3).toISOString(), ends_at: new Date(Date.now() + 2 * 86400e3).toISOString(), published: false })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;

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

  const box = '[aria-label="Draft a riddle with Claude"]';
  check("the draft box is on the Add key form", !!(await page.$(box)));
  await page.type(`${box} input`, "National Theatre, Iganmu, Lagos");
  await page.evaluate((b) => [...document.querySelectorAll(`${b} button`)].find((x) => x.textContent.includes("Draft with Claude"))?.click(), box);
  let drafts = 0;
  for (let i = 0; i < 90 && !drafts; i++) {
    await wait(1000);
    drafts = await page.evaluate(() => document.querySelectorAll('[aria-label="Riddle drafts"] button').length);
  }
  check("Claude's drafts appear", drafts >= 2, `${drafts}`);
  const first = await page.evaluate(() => {
    const b = document.querySelector('[aria-label="Riddle drafts"] button');
    return { riddle: b?.querySelector("span")?.textContent ?? "", all: b?.innerText ?? "" };
  });
  console.log(`  first draft: ${first.all.split("\n").join(" | ")}`);
  check("…none names the place", !/national theatre/i.test(await page.evaluate(() => [...document.querySelectorAll('[aria-label="Riddle drafts"] button > span:first-child')].map((s) => s.textContent).join(" "))));
  await page.screenshot({ path: `${OUT}/riddle-1-drafts.png`, fullPage: false });
  await page.evaluate(() => document.querySelector('[aria-label="Riddle drafts"] button')?.click());
  await wait(500);
  const filled = await page.evaluate(() => ({
    riddle: document.querySelector('textarea[name="riddle"]')?.value ?? "",
    clue: document.querySelector('input[name="clue"]')?.value ?? "",
  }));
  check("tapping one fills the riddle", filled.riddle.length > 5 && first.riddle.includes(filled.riddle.slice(0, 20)), filled.riddle);
  check("…and the Final Approach clue", filled.clue.length > 5, filled.clue);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`draft hunt and test admin deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
