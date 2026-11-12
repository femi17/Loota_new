// Finished hunters off the show (owner, 12 Nov 2026: "if a user get all key in the hunt there is no need broadcasting
// them again, they can free roam, but not broadcast"). Two hunters in a live test hunt, one who has won every key (1st):
//   - on the broadcast map only the one still hunting; the finished one on the leaderboard as 🏁 1st, not to be followed;
//   - the one still hunting followed, then finishing too: the broadcast goes back to the whole field.
// The hunt and the accounts are deleted.   node scripts/tests/broadcast-finished-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const ids = [];
let huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const user = async (tag) => {
  const email = `bfin-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};
const until = async (fn, ms = 30000) => { for (let t = 0; t < ms; t += 500) { const v = await fn(); if (v) return v; await wait(500); } return null; };

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const done = await user("done");
  const still = await user("still");
  const stamp = Date.now() % 1000;
  await admin.from("profiles").update({ username: `Winner${stamp}` }).eq("id", done.id);
  await admin.from("profiles").update({ username: `Racer${stamp}` }).eq("id", still.id);
  for (const [u, lng] of [[done, 3.3787], [still, 3.3887]]) await admin.from("player_positions").upsert({ user_id: u.id, lng, lat: 6.5186, mode: "walk", energy: 100, updated_at: ago(10) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Finished hunters test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "x", category: "maths", area_lng: 3.45, area_lat: 6.58, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.58 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: done.id, joined_at: ago(600), keys_held: 1, place: 1, finished_at: ago(60) });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: still.id, joined_at: ago(600) });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [...jar].map(([n, value]) => ({ name: n, value })), setAll: (l) => l.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: owner.email, password: owner.password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const show = await browser.newPage();
  await show.setViewport({ width: 1280, height: 720 });
  const problems = [];
  show.on("pageerror", (e) => problems.push(e.message));
  await show.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await show.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const shown = () => show.evaluate(() => Object.keys(window.__broadcastShown?.() ?? {})).catch(() => []);
  const drawn = await until(async () => { const k = await shown(); return k.includes(still.id) && k; });
  check("on the map: the hunter still racing", !!drawn);
  check("…not the one who has won every key", !!drawn && !drawn.includes(done.id), JSON.stringify(drawn?.filter((k) => k.length > 30)));
  const markers = await show.evaluate(() => [...document.querySelectorAll(".loota-hunter-marker .name")].map((e) => e.textContent).join(" | "));
  check("…no marker for them", !new RegExp(`Winner${stamp}`).test(markers), markers);
  const row = await show.evaluate((n) => { const b = [...document.querySelectorAll("ol button")].find((x) => x.textContent?.includes(n)); return b ? { text: b.textContent, disabled: b.disabled } : null; }, `Winner${stamp}`);
  check("on the leaderboard: 🏁 1st, and not to be followed", !!row && /🏁 1st/.test(row.text) && row.disabled, JSON.stringify(row));
  // Following the one still racing; then they finish too
  await show.evaluate((n) => [...document.querySelectorAll("ol button")].find((x) => x.textContent?.includes(n))?.click(), `Racer${stamp}`);
  const following = await until(() => show.evaluate((n) => (document.body.innerText.includes(`Following ${n}`) ? true : null), `Racer${stamp}`), 15000);
  check("following the hunter still racing", !!following);
  await admin.from("hunt_players").update({ keys_held: 1, place: 2, finished_at: new Date().toISOString() }).eq("hunt_id", huntId).eq("user_id", still.id);
  const back = await until(() => show.evaluate((n) => (!document.body.innerText.includes(`Following ${n}`) ? true : null), `Racer${stamp}`), 20000);
  check("they finish too: the broadcast goes back to the whole field", !!back);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
