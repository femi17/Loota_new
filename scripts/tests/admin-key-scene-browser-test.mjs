// The key's place in /admin (desktop): a temporary owner adds a key at a park in a throwaway draft hunt with the scene
// left on Automatic (it's guessed from our own places: a park), sees it in the key's row, and changes it to a market.
// The hunt and the temporary owner are deleted.   SHOTS=<folder> node scripts/tests/admin-key-scene-browser-test.mjs
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
const ids = [];
let huntId = null;
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  // A park in our places, in Lagos
  const { data: parks } = await admin.from("places").select("name, lng, lat").eq("kind", "rest").gte("lng", 3.36).lte("lng", 3.4).gte("lat", 6.49).lte("lat", 6.53).limit(1);
  const park = parks[0];
  const email = `admin-scene-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ is_admin: true, username: `Owner_${Date.now() % 1000}`, home_lng: park.lng, home_lat: park.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Admin scene test (automated)", prize: "none", winners: 1, starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 2 * 86400000).toISOString(), published: false, questions_per_trial: 2, seconds_per_question: 12, created_by: id })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });

  // ---- Add a key at the park, scene on Automatic
  const form = await page.evaluateHandle((h) => [...document.querySelectorAll("form")].find((f) => f.querySelector(`input[name=hunt][value="${h}"]`) && f.querySelector("textarea[name=riddle]")), huntId);
  const formEl = form.asElement();
  check("the hunt's Add key form, with the key's place", !!formEl && (await formEl.evaluate((f) => !!f.querySelector("select[name=scene]"))));
  const place = `${park.lat}, ${park.lng}`;
  await formEl.$("textarea[name=riddle]").then((e) => e.type("Where the city breathes."));
  await formEl.$("input[name=area]").then((e) => e.type(place));
  await formEl.$("input[name=spot]").then((e) => e.type(place));
  await page.screenshot({ path: `${OUT}/admin-1-form.png` });
  await Promise.all([page.waitForNavigation({ timeout: 90000 }), formEl.evaluate((f) => f.requestSubmit())]);
  const said = await page.evaluate(() => document.body.innerText.match(/Key 1 added[^\n]*/)?.[0] ?? "");
  const key = (await admin.from("hunt_keys").select("scene").eq("hunt_id", huntId).eq("n", 1).single()).data;
  check(`added on Automatic at ${park.name}: its place is a park`, key?.scene === "park" && /Its place: Park or garden \(by /.test(said), `${key?.scene} · ${said}`);
  await page.screenshot({ path: `${OUT}/admin-2-added.png` });

  // ---- Change it to a market from the key's row
  const row = await page.evaluateHandle((h) => [...document.querySelectorAll("form")].find((f) => f.querySelector(`input[name=hunt][value="${h}"]`) && f.querySelector("input[name=n]")), huntId);
  await row.asElement().$eval("select[name=scene]", (s) => (s.value = "market"));
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), row.asElement().evaluate((f) => f.requestSubmit())]);
  const changed = (await admin.from("hunt_keys").select("scene").eq("hunt_id", huntId).eq("n", 1).single()).data;
  const note = await page.evaluate(() => document.body.innerText.match(/Key 1's place is now[^\n]*/)?.[0] ?? "");
  check("changed from the key's row: now a market", changed?.scene === "market" && /Market/.test(note), `${changed?.scene} · ${note}`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    const { error } = await admin.from("hunts").delete().eq("id", huntId);
    if (error) console.log("hunt cleanup failed:", error.message);
  }
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test owner deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
