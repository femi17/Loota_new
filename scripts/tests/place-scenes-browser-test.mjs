// The petrol station, the place to eat and the hospital as scenes on the map (phone; open-roof places, the talk in
// bubbles and a strip at the bottom): Refuel opens the attendant (the meter runs,
// the tank fills, a keg for the road), Eat opens the cook (the day's menu, the plate cleared, +energy), and leaving
// hospital brings the nurse (the bill, the damaged bicycle). The test player is deleted.
//   SHOTS=<folder> node scripts/tests/place-scenes-browser-test.mjs
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
const ids = [];
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const box = { lng0: 3.37, lng1: 3.39, lat0: 6.51, lat1: 6.53 }; // Yaba
const placeOf = async (kind) =>
  (await admin.from("places").select("name, lng, lat").eq("kind", kind).gte("lng", box.lng0).lte("lng", box.lng1).gte("lat", box.lat0).lte("lat", box.lat1).limit(1)).data[0];

try {
  const station = await placeOf("fuel");
  const food = await placeOf("eat");
  const hospital = await placeOf("hospital");
  const email = `scenes-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: station.lng, home_lat: station.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Place scenes test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: station.lng, lat: station.lat, mode: "walk", energy: 50, updated_at: ago(30) });
  await admin.from("player_vehicles").insert([
    { user_id: id, kind: "motorbike", fuel: 0, tyre: 100, engine: 100, lng: station.lng, lat: station.lat, in_use: false },
  ]);

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const problems = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const text = (sel) => page.evaluate((s, nl) => document.querySelector(s)?.innerText.split(nl).join(" | ") ?? null, sel, NL);
  const shot = (name) => page.screenshot({ path: `${OUT}/scenes-${name}.png` });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const clickText = (x) => page.evaluate((s) => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((e) => e.textContent?.trim().startsWith(s));
    b?.click();
    return !!b;
  }, x);
  const clickWhenThere = async (x) => {
    for (let i = 0; i < 20; i++) {
      if (await clickText(x)) return true;
      await wait(500);
    }
    return false;
  };
  const open = async () => {
    await page.goto("about:blank");
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };
  const tapHere = (x) => page.evaluate((s) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(s))?.click(), x);

  // ---- The petrol station
  await open();
  await tapHere("Refuel");
  await wait(4500); // the place grows in and the attendant's greeting types itself out
  const fuelScene = await text(`[role="dialog"][aria-label="Petrol station: ${station.name}"]`);
  check(`Refuel opens the attendant at ${station.name}`, /Welcome.* Bring your okada out of your pocket/.test(fuelScene ?? ""), fuelScene);
  await shot("1-station");
  const before = await coins();
  check("…and fills it up", await clickWhenThere("Fill it up · 200 coins"));
  let filled = null;
  for (let i = 0; i < 24 && !/Full tank! 200 coins/.test(filled ?? ""); i++) {
    await wait(500);
    filled = await text('[role="dialog"]');
  }
  // (The meter counts up on the pump in 3D; what it came to, the attendant says.)
  check("the pump ran to 200, a full tank", /Full tank! 200 coins/.test(filled ?? ""), filled);
  const bike = (await admin.from("player_vehicles").select("fuel").eq("user_id", id).eq("kind", "motorbike").single()).data;
  check("…200 coins, the tank at 100%", (await coins()) === before - 200 && bike.fuel >= 99, `${before - (await coins())} · ${bike.fuel}`);
  await shot("2-filled");
  check("a keg for the road", await clickWhenThere("Yes, a keg"));
  await wait(2500);
  const keg = (await admin.from("player_kegs").select("uses_left").eq("user_id", id)).data;
  check("…bought (25 coins)", keg.length === 1 && (await coins()) === before - 225, JSON.stringify(keg));
  await clickWhenThere("Thanks!");
  await wait(800);
  check("…and the scene closes", (await page.$('[role="dialog"]')) === null);

  // ---- The place to eat
  await admin.from("player_positions").update({ lng: food.lng, lat: food.lat, energy: 50, updated_at: ago(30) }).eq("user_id", id);
  await open();
  await tapHere("Eat");
  await wait(5500); // the greeting types itself out
  const meal = await text(`[role="dialog"][aria-label="Eating at ${food.name}"]`);
  check(`Eat opens the cook at ${food.name}, with today's menu`, /What will you chop\?/.test(meal ?? "") && (meal?.match(/· 30 coins/g) ?? []).length === 3, meal);
  await shot("3-menu");
  const coinsBefore = await coins();
  const dish = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent ?? "").find((t) => t.includes("· 30 coins")));
  check("…orders the first dish", await clickWhenThere(dish.split(" · ")[0]));
  await wait(1200);
  await shot("4-plate");
  await wait(3500);
  const ate = await text('[role="dialog"]');
  const energy = (await admin.from("player_positions").select("energy").eq("user_id", id).single()).data.energy;
  check("the plate cleared: +40 energy, 30 coins", /cleaned the plate.*\+40 energy/.test(ate ?? "") && (await coins()) === coinsBefore - 30 && energy >= 85, `${coinsBefore - (await coins())} · ${energy}`);
  await shot("5-ate");
  await clickWhenThere("Thank you");

  // ---- Out of hospital, with a damaged bicycle
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 100, engine: 100, lng: hospital.lng, lat: hospital.lat, in_use: false, broken_at: ago(300) });
  await admin.from("player_positions").update({ lng: hospital.lng, lat: hospital.lat, energy: 0, fainted_at: ago(300), updated_at: ago(30) }).eq("user_id", id);
  await admin.from("hospital_visits").upsert({
    user_id: id, hospital: hospital.name, lng: hospital.lng, lat: hospital.lat, bill: 50,
    approach: [[hospital.lng + 0.01, hospital.lat], [hospital.lng + 0.005, hospital.lat]],
    route: [[hospital.lng + 0.005, hospital.lat], [hospital.lng, hospital.lat]],
    called_at: ago(300), picked_at: ago(240), arrives_at: ago(120), discharged_at: ago(5), left_at: null,
  });
  await open();
  const nurse = await text(`[role="dialog"][aria-label="Leaving ${hospital.name}"]`);
  check(`the nurse at ${hospital.name}`, /the ambulance brought you to/.test(nurse ?? "") && /70 energy/.test(nurse ?? ""), nurse);
  await shot("6-nurse");
  // In the world only the newest line shows (in the bubble over the nurse): each answer in turn.
  await clickWhenThere("How much do I owe?");
  await wait(3500);
  const bill = await text('[role="dialog"]');
  await clickWhenThere("What about my bicycle?");
  await wait(4500);
  const talk = await text('[role="dialog"]');
  check("…the bill and the bicycle", /50 coins, and it's already paid/.test(bill ?? "") && /repair shop not far from here/.test(talk ?? ""), `${bill} // ${talk}`);
  await shot("7-nurse-talk");
  await clickWhenThere("Thank you, nurse");
  await clickWhenThere("Bye");
  await wait(800);
  check("…and the scene closes", (await page.$('[role="dialog"]')) === null);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
