// The broadcast screen (design doc 11), on a laptop-size screen as the owner: a live test hunt with two hunters (one in
// a Key Trial): the title card, the leaderboard (with TRIAL), a dot and name for each hunter on the map, the ticker;
// clicking a name follows them (the 3D avatar up close). The hunt, the hunters and the owner account are deleted.
//   SHOTS=<folder> node scripts/tests/broadcast-browser-test.mjs
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
const NL = String.fromCharCode(10);
const ids = [];
let huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const user = async (tag) => {
  const email = `bcast-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const a = await user("ada"), b = await user("bayo");
  const names = { [a.id]: `Ada${Date.now() % 1000}`, [b.id]: `Bayo${Date.now() % 1000}` };
  for (const [id, name] of Object.entries(names)) await admin.from("profiles").update({ username: name }).eq("id", id);
  await admin.from("player_positions").upsert([
    { user_id: a.id, lng: 3.3787, lat: 6.5186, mode: "walk", energy: 80, updated_at: ago(5) },
    { user_id: b.id, lng: 3.3950, lat: 6.5020, mode: "walk", energy: 80, updated_at: ago(5) },
  ]);
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast test (automated)", prize: "₦50,000", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.38, area_lat: 6.52, area_radius_m: 1500, spot_lng: 3.38, spot_lat: 6.52, exact_m: 120 });
  await admin.from("hunt_players").insert([{ hunt_id: huntId, user_id: a.id, joined_at: ago(600) }, { hunt_id: huntId, user_id: b.id, joined_at: ago(500) }]);
  await admin.from("trial_attempts").insert({ hunt_id: huntId, user_id: b.id, key_n: 1, status: "active", started_at: ago(20), kind: "sentries", questions: [] }).then(({ error: e }) => e && console.log("(trial row:", e.message, ")"));

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: owner.email, password: owner.password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setViewport({ width: 1600, height: 900 });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const body = () => page.evaluate((nl) => document.body.innerText.split(nl).join(" | "), NL);
  let text = "";
  for (let t = 0; t < 60 && !/Leaderboard/.test(text); t++) { await wait(500); text = await body(); }
  await wait(6000); // the map settles round everyone
  text = await body();
  check("the title card: LIVE, the hunt, the prize", /LIVE/.test(text) && /Broadcast test \(automated\)/.test(text) && /₦50,000/.test(text), text.slice(0, 160));
  check("the leaderboard: both hunters, one in a TRIAL", text.includes(names[a.id]) && text.includes(names[b.id]) && /TRIAL/.test(text));
  const dots = await page.$$eval(".loota-hunter-marker", (els) => els.length);
  check("a dot and name for each hunter on the map", dots === 2, `${dots} on the map`);
  check("the ticker: who joined, who started a trial", /joined the hunt/.test(text) && /started the Key Trial/.test(text));
  await page.screenshot({ path: `${OUT}/broadcast-1-field.png` });
  await page.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), names[a.id]);
  await wait(5000);
  check("clicking a name follows them", (await body()).includes(`Following ${names[a.id]}`));
  await page.screenshot({ path: `${OUT}/broadcast-2-follow.png` });
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
