// Back on the road after a jerry can (owner, 19 Oct 2026: "when I poured the fuel, my old route… is gone… but I still
// have the directions toast"), on a phone. (1) On a journey: riding there, the tank runs dry; the way to the petrol
// station takes over while the journey card waits; with the jerry can poured in, the way to the journey's place is
// drawn again. (2) Heading somewhere without a journey, the game reopened while the vehicle waits at the roadside:
// pouring takes up the way to that place again. The test player is deleted.
//   SHOTS=<folder> node scripts/tests/resume-after-fuel-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
/** The pour is a scene (owner, 26 Oct 2026): "Pour it in", watch the gauges, then "Ride on". */
async function pourScene(page) {
  const click = (t) => page.evaluate((x) => {
    const b = [...document.querySelectorAll('[role="dialog"][aria-label="Pouring the jerry can"] button')].find((e) => e.textContent?.includes(x));
    b?.click();
    return !!b;
  }, t);
  for (let i = 0; i < 20 && !(await click("Pour it in")); i++) await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 30 && !(await click("Ride on")); i++) await new Promise((r) => setTimeout(r, 300));
}

process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const NL = String.fromCharCode(10);
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 }; // Club Road, Yaba
const dest = { name: "Unilag Senate Building", lng: 3.3985, lat: 6.5175 }; // ~2.2 km east
const m = (a, b) => Math.hypot((a[0] - b[0]) * 110400, (a[1] - b[1]) * 110574);

try {
  const email = `resume-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 300, p_kind: "admin", p_reason: "Resume test" });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 0.4, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: true, helmet: true, registered: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Probe", resolved_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date(Date.now() + 3600e3).toISOString() });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 600000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  const shot = (name) => page.screenshot({ path: `${OUT}/resume-${name}.png` });
  const body = () => page.evaluate((nl) => document.body.innerText.split(nl).join(" | "), NL);
  const bike = async () => (await admin.from("player_vehicles").select("fuel, in_use, stranded_at, lng, lat").eq("user_id", id).single()).data;
  const routeEnd = () => page.evaluate(() => {
    const d = window.__lootaMap.getSource("route").serialize().data;
    const coords = d?.geometry?.coordinates ?? [];
    return coords.length > 1 ? coords.at(-1) : null;
  });
  const waitEnd = async (near, within) => {
    let e = null;
    for (let i = 0; i < 30; i++) {
      e = await routeEnd();
      if (e && m(e, near) < within) return e;
      await wait(1000);
    }
    return e;
  };
  const open = async () => {
    await page.goto("about:blank");
    await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(18000);
  };

  // ---- (1) On a journey, the tank runs dry
  const journey = {
    journey: {
      mode: "drive",
      place: { name: dest.name, detail: "University of Lagos", lng: dest.lng, lat: dest.lat },
      legs: [{ kind: "go", to: { name: dest.name, lng: dest.lng, lat: dest.lat }, metres: 2500, seconds: 60, fare: null, how: "Ride your motorbike" }],
      seconds: 60,
      fare: null,
    },
    step: 0,
  };
  await page.evaluateOnNewDocument((j) => {
    try {
      if (location.pathname === "/play" && !sessionStorage.getItem("journey-set")) {
        localStorage.setItem("loota:journey", j);
        sessionStorage.setItem("journey-set", "1");
      }
    } catch {
      // about:blank has no storage
    }
  }, JSON.stringify(journey));
  await open();
  const toDest = await waitEnd([dest.lng, dest.lat], 150);
  check("on a journey: the way to the place drawn", !!toDest && m(toDest, [dest.lng, dest.lat]) < 150, JSON.stringify(toDest));
  check("…the journey card", /Your journey|Step 1 of 1|Unilag Senate/.test(await body()));
  await page.keyboard.down("ArrowUp");
  let b = await bike();
  for (let i = 0; i < 40 && !b.stranded_at; i++) { await wait(1000); b = await bike(); }
  await page.keyboard.up("ArrowUp");
  check("ridden dry: the motorbike waits at the roadside", !!b.stranded_at, JSON.stringify(b));
  await wait(6000);
  const { data: stations } = await admin.from("places").select("lng, lat").eq("kind", "fuel").gte("lng", b.lng - 0.05).lte("lng", b.lng + 0.05).gte("lat", b.lat - 0.05).lte("lat", b.lat + 0.05);
  const toStation = await routeEnd();
  const nearStation = toStation ? Math.min(...stations.map((s) => m(toStation, [s.lng, s.lat]))) : Infinity;
  check("…the way to a petrol station takes over (not the journey's place)", nearStation < 120 && m(toStation, [dest.lng, dest.lat]) > 300, `${Math.round(nearStation)} m from a station`);
  await shot("1-to-station");

  // A full jerry can and back beside the motorbike (the fetching is the jerry-can test's part).
  await admin.from("player_kegs").upsert({ user_id: id, fuel: 65, uses_left: 50 });
  await admin.from("player_positions").update({ lng: b.lng, lat: b.lat, mode: "walk", updated_at: ago(30) }).eq("user_id", id);
  await open();
  check("beside it: Pour can", await page.evaluate(() => {
    const x = [...document.querySelectorAll("button")].find((e) => e.textContent?.includes("Pour can"));
    x?.click();
    return !!x;
  }));
  await pourScene(page);
  await wait(4000);
  const said = await body();
  check("poured: back on it, on to the journey's place", /you're back on it\. On to Unilag Senate Building/.test(said), said.match(/Poured[^|]*/)?.[0]);
  const back = await waitEnd([dest.lng, dest.lat], 150);
  check("…its way drawn again", !!back && m(back, [dest.lng, dest.lat]) < 150, JSON.stringify(back));
  await shot("2-resumed");

  // ---- (2) No journey: heading somewhere, the game reopened while the motorbike waits
  await page.evaluate(() => localStorage.removeItem("loota:journey"));
  await admin.from("player_vehicles").update({ fuel: 0, in_use: false, stranded_at: new Date().toISOString() }).eq("user_id", id);
  const vb = await bike();
  await admin.from("player_positions").update({ lng: vb.lng, lat: vb.lat, mode: "walk", updated_at: ago(30) }).eq("user_id", id);
  await admin.from("player_kegs").upsert({ user_id: id, fuel: 65, uses_left: 49 });
  const place2 = { name: "Yaba Market", lng: 3.3772, lat: 6.5056 };
  await page.evaluate((p) => localStorage.setItem("loota:going-before-dry", JSON.stringify(p)), place2);
  await open();
  await page.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.textContent?.includes("Pour can"))?.click());
  await pourScene(page);
  await wait(4000);
  check("reopened, then poured: on to the place you were heading for", /On to Yaba Market/.test(await body()));
  const back2 = await waitEnd([place2.lng, place2.lat], 200);
  check("…its way drawn again", !!back2 && m(back2, [place2.lng, place2.lat]) < 200, JSON.stringify(back2));
  check("…and nothing left over", await page.evaluate(() => localStorage.getItem("loota:going-before-dry") === null));
  await shot("3-resumed-plain");
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
