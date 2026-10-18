// A landmark's check-in and a Detour from the Lamp, as scenes on the map (phone): "Check in" → the guide at the
// landmark's plaza → "I'm ready!" (the clock starts) → the question, against the clock → the right answer → the fact
// and the coins; "Claim" at a Detour (in a throwaway live hunt) → the Lamp's messenger by the glowing lamp → ready →
// the right answer → the prize. The test hunt, Detour and players are deleted.
//   SHOTS=<folder> node scripts/tests/quiz-scenes-browser-test.mjs
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
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
const ids = [];
let huntId = null;
let detourId = null;
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

async function player(tag, at) {
  const email = `quiz-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ username: `Quiz_${Date.now() % 1000}`, home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  return { id, jar };
}

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const open = async (who) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...who.jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
    const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
    const clickText = (x) => page.evaluate((s) => {
      const b = [...document.querySelectorAll("button")].find((e) => (e.textContent?.trim() === s || e.textContent?.trim().startsWith(s) || e.getAttribute("aria-label")?.startsWith(s)) && !e.disabled);
      b?.click();
      return !!b;
    }, x);
    const clickWhenThere = async (x, tries = 24) => {
      for (let i = 0; i < tries; i++) {
        if (await clickText(x)) return true;
        await wait(500);
      }
      return false;
    };
    const textWhen = async (sel, re, tries = 24) => {
      let t = null;
      for (let i = 0; i < tries && !re.test(t ?? ""); i++) {
        await wait(500);
        t = await text(sel);
      }
      return t;
    };
    return { page, problems, text, clickText, clickWhenThere, textWhen };
  };
  const coins = async (id) => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;

  // ---- 1. A landmark's check-in
  const { data: lms } = await admin.from("landmarks").select("id, name, lng, lat, questions").gte("lng", 3.3).lte("lng", 3.45).gte("lat", 6.43).lte("lat", 6.56).limit(1);
  const lm = lms[0];
  const visitor = await player("lm", lm);
  const v = await open(visitor);
  check(`at ${lm.name}: the Check in button`, await v.clickWhenThere(`Check in at ${lm.name}`, 20));
  const intro = await v.textWhen(`[role="dialog"][aria-label="Checking in at ${lm.name}"]`, /Ready\?/);
  check("the guide greets you at the plaza (the clock not yet running)", /a guide here\. Answer one question about this place/.test(intro ?? "") && !/s left/.test(intro ?? ""), intro);
  await v.page.screenshot({ path: `${OUT}/quiz-1-guide.png` });
  const before = await coins(visitor.id);
  await v.clickWhenThere("I'm ready!");
  const asked = await v.textWhen('[role="dialog"]', /s left/);
  check("…then the question, against the clock", /\d+ s left/.test(asked ?? ""), asked);
  const { data: ci } = await admin.from("landmark_checkins").select("question").eq("user_id", visitor.id).order("asked_at", { ascending: false }).limit(1).single();
  const q = lm.questions[ci.question];
  await v.page.screenshot({ path: `${OUT}/quiz-2-question.png` });
  await v.clickWhenThere(q.options[q.answer]);
  const right = await v.textWhen('[role="dialog"]', /Here are your \d+ coins/);
  check("the right answer: the fact and the coins", /Correct!.*Here are your \d+ coins/.test(right ?? "") && (await coins(visitor.id)) > before, `${(await coins(visitor.id)) - before} coins · ${right}`);
  await v.page.screenshot({ path: `${OUT}/quiz-3-correct.png` });
  await v.clickWhenThere("Thank you!");
  await wait(2500);
  check("…and back to the street", (await v.page.$('[role="dialog"]')) === null);
  check("no page errors (landmark)", v.problems.length === 0, v.problems.join(" / "));
  await v.page.close();

  // ---- 2. A Detour from the Lamp, in a live hunt
  const spot = { lng: 3.378214, lat: 6.500147 };
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Quiz test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: soon(3600), published: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Far away.", category: "general", area_lng: 3.5, area_lat: 6.6, area_radius_m: 800, spot_lng: 3.5, spot_lat: 6.6 });
  const seeker = await player("lamp", spot);
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: seeker.id, joined_at: ago(60), keys_held: 0, finished_at: null, place: null });
  const { data: d } = await admin.from("detours").insert({
    kind: "flash", area: `${Math.floor(spot.lng / 0.1)}:${Math.floor(spot.lat / 0.1)}`, title: "The silver pouch", story: "Someone dropped a pouch of coins by this road.",
    place_name: "the corner by the kiosk", lng: spot.lng, lat: spot.lat, reward_coins: 15, ends_at: soon(240),
  }).select("id").single();
  detourId = d.id;
  const s = await open(seeker);
  check("at the Detour: the Claim button", await s.clickWhenThere("Claim The silver pouch", 20));
  const greet = await s.textWhen('[role="dialog"][aria-label="The silver pouch"]', /Ready\?/);
  check("the Lamp's messenger by the glowing lamp", /you followed the lamp\. Someone dropped a pouch/.test(greet ?? "") && /15 coins is yours/.test(greet ?? ""), greet);
  await s.page.screenshot({ path: `${OUT}/quiz-4-messenger.png` });
  const sBefore = await coins(seeker.id);
  await s.clickWhenThere("I'm ready!");
  await s.textWhen('[role="dialog"][aria-label="The silver pouch"]', /s left/);
  const { data: claim } = await admin.from("detour_claims").select("question").eq("detour_id", detourId).eq("user_id", seeker.id).single();
  await s.clickWhenThere(String(claim.question.choices[claim.question.answer]));
  const won = await s.textWhen('[role="dialog"][aria-label="The silver pouch"]', /are yours/);
  check("the right answer: the prize", /You got it! 15 coins are yours/.test(won ?? "") && (await coins(seeker.id)) === sBefore + 15, `${(await coins(seeker.id)) - sBefore} · ${won}`);
  await wait(1200);
  await s.page.screenshot({ path: `${OUT}/quiz-5-won.png` });
  check("no page errors (detour)", s.problems.length === 0, s.problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (detourId) await admin.from("detours").delete().eq("id", detourId);
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    const { error } = await admin.from("hunts").delete().eq("id", huntId);
    if (error) console.log("hunt cleanup failed:", error.message);
  }
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
