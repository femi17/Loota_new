// The Djinn's Wonders in the browser (phone): Wonders in the bag with Use buttons, the Eye's card, a rival's
// Orb of Return and Hourglass felt on screen (banner, frozen chip, frost), and the Carpet flying abroad.
// Plays in a throwaway live hunt; the hunt, its news and the test players are deleted afterwards.
//   SHOTS=<folder> node scripts/tests/wonder-powers-browser-test.mjs
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
const metres = (a, b) => {
  const k = Math.PI / 180, dLat = (b.lat - a.lat) * k, dLng = (b.lng - a.lng) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const ids = [];
let huntId = null;
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

const yaba = { lng: 3.3787, lat: 6.5186 };
const home = { lng: 3.3615, lat: 6.5005 }; // the player's home, a few km away
async function player(tag, at, homeAt) {
  const email = `wonder-b-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ username: `${tag}_${Date.now() % 1000}`, home_lng: homeAt.lng, home_lat: homeAt.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 90, updated_at: ago(30) });
  return { id, email, password };
}
const give = async (p, wonder) => (await admin.from("player_wonders").insert({ user_id: p.id, wonder }).select("id").single()).data.id;

try {
  const me = await player("Seeker", yaba, home);
  const rival = await player("Rival", { lng: yaba.lng + 0.01, lat: yaba.lat }, { lng: 3.40, lat: 6.55 });
  const { data: hunt, error } = await admin
    .from("hunts")
    .insert({ title: "Wonder test (automated)", prize: "none", winners: 3, starts_at: ago(3600), ends_at: new Date(Date.now() + 2 * 3600_000).toISOString(), published: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id")
    .single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The test riddle 1", category: "general", area_lng: 3.39, area_lat: 6.53, area_radius_m: 500, spot_lng: 3.39, spot_lat: 6.53 });
  await admin.from("hunt_players").insert([{ hunt_id: huntId, user_id: me.id }, { hunt_id: huntId, user_id: rival.id }]);
  for (const w of ["eye_of_the_djinn", "carpet_of_kings", "djinn_coin"]) await give(me, w);
  const ret = await give(rival, "orb_of_return");
  const ret2 = await give(rival, "orb_of_return");
  const hg = await give(rival, "hourglass_of_ages");

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: me.email, password: me.password });
  const rc = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await rc.auth.signInWithPassword({ email: rival.email, password: rival.password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  // Every Wonder banner, from the moment the page loads (they fade).
  await page.evaluateOnNewDocument(() => {
    window.__banners = [];
    new MutationObserver(() => {
      const t = document.querySelector(".loota-wonder-banner")?.textContent;
      if (t && window.__banners.at(-1) !== t) window.__banners.push(t);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const clickText = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll("button")].find((y) => (y.textContent?.includes(x) || y.getAttribute("aria-label")?.includes(x)) && !y.disabled); b?.click(); return !!b; }, t);
  const banners = () => page.evaluate(() => window.__banners);
  const shot = (name) => page.screenshot({ path: `${OUT}/wonder-${name}.png` });

  await page.goto(`http://localhost:3000/play?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);

  // ---- The bag: the Wonders, each with its button (the Coin works by itself)
  await clickText("Bag");
  await wait(1500);
  const bag = await text('[aria-label="Your Wonders"]');
  check("the bag shows the 3 Wonders", /Eye of the Djinn/.test(bag ?? "") && /Carpet of Kings/.test(bag ?? "") && /Coin/.test(bag ?? ""), bag);
  check("…with Open and Fly buttons, and none for the Coin", /Open/.test(bag) && /Fly/.test(bag) && /works by itself/.test(bag));
  await shot("1-bag");

  // ---- The Eye: tap, confirm, and its card on the map
  await clickText("Open");
  await wait(300);
  check("a Wonder asks to be sure first", /Tap again/.test((await text('[aria-label="Your Wonders"]')) ?? ""));
  await clickText("Tap again");
  await wait(4000);
  await clickText("Close");
  await wait(6000);
  const eyeCard = await text('[aria-label="The Eye of the Djinn"]');
  check("the Eye's card sees the rival", !!eyeCard && eyeCard.includes("Rival_"), eyeCard);
  check("…and the holder's banner", (await banners()).some((b) => /opened the Eye/.test(b)), JSON.stringify(await banners()));
  await shot("2-eye");

  // ---- A rival's Orb of Return: the player's Djinn's Coin spares them; a second one sends them home
  const { data: r1 } = await rc.rpc("use_wonder", { p_wonder: ret });
  check("the rival raises the Orb of Return", r1?.ok && r1.spared === 1, JSON.stringify(r1));
  await wait(12000);
  check("the player hears of it: spared by the Coin", (await banners()).some((b) => /Orb of Return/.test(b) && /Coin glowed and spared you/.test(b)), JSON.stringify(await banners()));
  await shot("3-spared");
  await wait(6000); // the next banner
  const { data: r1b } = await rc.rpc("use_wonder", { p_wonder: ret2 });
  check("…and raises another", r1b?.ok && r1b.spared === 0, JSON.stringify(r1b));
  await wait(12000);
  check("the player hears of it, hit", (await banners()).some((b) => /Orb of Return/.test(b) && /You're back home/.test(b)), JSON.stringify(await banners()));
  const back = (await admin.from("player_positions").select("lng, lat").eq("user_id", me.id).single()).data;
  check("…and is at home", metres(back, home) < 300, `${Math.round(metres(back, home))} m from home`);
  await shot("3-return");

  // ---- The rival's Hourglass: frozen chip and frost
  const { data: r2 } = await rc.rpc("use_wonder", { p_wonder: hg });
  check("the rival turns the Hourglass", r2?.ok, JSON.stringify(r2));
  await wait(12000);
  const frozen = await text('[aria-label="Frozen by the Hourglass of Ages"]');
  check("the player is frozen: the chip counts down", !!frozen && /Frozen \d:\d\d/.test(frozen), frozen);
  check("…with frost on the screen", await page.evaluate(() => !!document.querySelector(".loota-frost")));
  await shot("4-frozen");
  // Thaw.
  await admin.from("wonder_events").update({ ends_at: ago(1) }).eq("wonder", "hourglass_of_ages").eq("hunt_id", huntId);
  await wait(10000);
  check("thawed: the chip and the frost go", !(await text('[aria-label="Frozen by the Hourglass of Ages"]')) && !(await page.evaluate(() => !!document.querySelector(".loota-frost"))));

  // ---- The Carpet of Kings: where to?, then away to Accra
  await clickText("Bag");
  await wait(1500);
  await clickText("Fly");
  await wait(300);
  await clickText("Tap again");
  await wait(1000);
  check("the Carpet asks where to", !!(await page.evaluate(() => [...document.querySelectorAll("span")].some((s) => s.textContent?.includes("Where shall the Carpet")))));
  await page.type('input[type="search"]', "Accra, Ghana", { delay: 40 });
  await wait(4000);
  await shot("5-carpet");
  await page.keyboard.press("Enter");
  await wait(8000);
  const pos = (await admin.from("player_positions").select("lng, lat").eq("user_id", me.id).single()).data;
  const accra = { lng: -0.187, lat: 5.6037 };
  check("the Carpet flies the player to Accra", metres(pos, accra) < 30000, `${Math.round(metres(pos, accra) / 1000)} km from Accra`);
  await wait(12000);
  await shot("6-accra");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (ids.length) await admin.from("wonder_events").delete().in("user_id", ids);
  if (huntId) {
    await admin.from("wonder_events").delete().eq("hunt_id", huntId);
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
