// Traffic lights and traffic (phone), on Victoria Island / Lekki where Lagos has most lights, with the page's clock
// at the Monday evening rush (17:30 Lagos): a taxi ride through several lights waits at red ones and crawls in
// go-slows yet arrives on time; then a hunter driving a car stops at a red light and goes on green.
// The test players are deleted.
//   SHOTS=<folder> node --import ./scripts/tests/ts-ext.mjs scripts/tests/traffic-lights-browser-test.mts
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData } from "@/game/roadData";
import * as roads from "@/game/roads";
import { distanceM } from "@/game/geo";
import { signalState, signalsOnPath, withGroups, type Signal } from "@/game/signals";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const soon = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const ids: string[] = [];
let browser: import("puppeteer-core").Browser | undefined;
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};
// The page's clock: Monday 19 Oct 2026, 17:30 in Lagos (the evening rush).
const OFFSET = Date.parse("2026-10-19T16:30:00Z") - Date.now();
const pageNow = () => Date.now() + OFFSET;

// ---- A taxi's way through the lights: our own roads, by car
const all: Signal[] = withGroups(JSON.parse(readFileSync(new URL("../../public/data/traffic-signals.json", import.meta.url), "utf8")).signals);
const area = all.filter((s) => s.lng > 3.415 && s.lng < 3.45 && s.lat > 6.43 && s.lat < 6.45);
const keys = new Set<string>();
for (let ix = Math.floor(3.405 / ROAD_CELL_DEG); ix <= Math.floor(3.46 / ROAD_CELL_DEG); ix++)
  for (let iy = Math.floor(6.42 / ROAD_CELL_DEG); iy <= Math.floor(6.46 / ROAD_CELL_DEG); iy++) keys.add(roadCellKey(ix, iy));
const cells: RoadCellData[] = [];
for (const key of keys) {
  const res = await fetch(`${url}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
  if (res.ok) cells.push(decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()));
}
const net = roads.buildNetworkFromCells(cells, "car", { lng: 3.43, lat: 6.44 }, Infinity);
let best: { path: [number, number][]; cum: number[]; lights: { signal: Signal; s: number }[] } | null = null;
for (const a of area) {
  for (const b of area) {
    const m = distanceM([a.lng, a.lat], [b.lng, b.lat]);
    if (m < 1500 || m > 3500) continue;
    const start = roads.snapToNetwork(net, a, 0);
    const path = start ? (roads.findPath(net, start, b, 60) as [number, number][] | null) : null;
    if (!path) continue;
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distanceM(path[i - 1], path[i]));
    const lights = signalsOnPath(all, path, cum).filter((l) => l.s > 10 && l.s < cum.at(-1)! - 10);
    if (!best || lights.length > best.lights.length) best = { path, cum, lights };
  }
}
console.log(`a taxi route of ${Math.round(best!.cum.at(-1)!)} m through ${best!.lights.length} lights`);

async function player(tag: string, at: { lng: number; lat: number }, mode: string) {
  const email = `lights-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id as string;
  ids.push(id);
  await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode, energy: 90, updated_at: ago(30) });
  const jar = new Map<string, string>();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list: { name: string; value: string }[]) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))),
    },
  });
  await c.auth.signInWithPassword({ email, password });
  return { id, jar };
}

async function openPage(jar: Map<string, string>) {
  const page = await browser!.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push((e as Error).message));
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((offset: number) => {
    const Real = Date;
    const now = () => Real.now() + offset;
    class Fake extends Real {
      constructor(...a: unknown[]) {
        // @ts-expect-error -- passing the arguments through
        super(...(a.length ? a : [now()]));
      }
      static now() {
        return now();
      }
    }
    // @ts-expect-error -- the page's clock, moved to the rush hour
    window.Date = Fake;
  }, OFFSET);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  return { page, problems };
}

try {
  browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
  });

  // ---- 1. The taxi ride
  const route = best!;
  const first = { lng: route.path[0][0], lat: route.path[0][1] };
  const last = route.path.at(-1)!;
  const rider = await player("taxi", first, "walk");
  const rideS = 40; // about what the server gives a 3 km taxi ride at rush hour
  const { error: tripErr } = await admin.from("transit_trips").insert({
    user_id: rider.id, mode: "taxi", from_name: "Test pickup", to_name: "Test drop-off", to_lng: last[0], to_lat: last[1],
    path: route.path, path_m: route.cum.at(-1), fare: 0, departs_at: soon(25), arrives_at: soon(25 + rideS),
  });
  if (tripErr) throw tripErr;
  const { page, problems } = await openPage(rider.jar);
  const seen: string[] = [];
  const start = Date.now();
  let shotRed = false;
  let shotJam = false;
  while (Date.now() - start < (25 + rideS + 60) * 1000) {
    const status = await page.evaluate(() => document.querySelector('[aria-label="Your trip"]')?.textContent ?? "");
    if (status && seen.at(-1) !== status) seen.push(status);
    if (!shotRed && /Red light/.test(status)) {
      shotRed = true;
      await page.screenshot({ path: `${OUT}/lights-1-taxi-red.png` });
    }
    if (!shotJam && /Go-slow/.test(status)) {
      shotJam = true;
      await page.screenshot({ path: `${OUT}/lights-2-taxi-goslow.png` });
    }
    if (!status && Date.now() - start > (25 + rideS) * 1000) break;
    await wait(400);
  }
  const reds = seen.filter((s) => /Red light/.test(s)).length;
  check("the taxi waited at red lights on the way", reds > 0, `${reds} status lines with a red light`);
  check("…and crawled through go-slows or slow traffic", seen.some((s) => /Go-slow|Slow traffic/.test(s)));
  const { data: trip } = await admin.from("transit_trips").select("ended_at, outcome").eq("user_id", rider.id).single();
  check("…yet arrived on time", trip?.outcome === "arrived", JSON.stringify(trip));
  check("no page errors (taxi)", problems.length === 0, problems.join(" / "));
  await page.close();

  // ---- 2. Driving up to a red light
  const light = route.lights[Math.floor(route.lights.length / 2)];
  const back = (m: number) => {
    let i = 1;
    while (i < route.cum.length - 1 && route.cum[i] < light.s - m) i++;
    const f = (light.s - m - route.cum[i - 1]) / (route.cum[i] - route.cum[i - 1] || 1);
    return { lng: route.path[i - 1][0] + f * (route.path[i][0] - route.path[i - 1][0]), lat: route.path[i - 1][1] + f * (route.path[i][1] - route.path[i - 1][1]) };
  };
  const startAt = back(70);
  const driver = await player("car", startAt, "car");
  await admin.from("player_vehicles").insert({ user_id: driver.id, kind: "car", fuel: 100, tyre: 100, engine: 100, lng: startAt.lng, lat: startAt.lat, in_use: true });
  const car = await openPage(driver.jar);
  await wait(18000);
  // Wait for the light to turn red (on the page's clock), then drive at it.
  const untilRed = async () => {
    for (let i = 0; i < 300 && !(signalState(light.signal.group, pageNow()).light === "red" && signalState(light.signal.group, pageNow()).changesIn > 7000); i++) await wait(100);
  };
  await untilRed();
  const where = () => admin.from("player_positions").select("lng, lat").eq("user_id", driver.id).single().then((r: { data: { lng: number; lat: number } }) => r.data);
  let chip: string | null = null;
  for (let attempt = 0; attempt < 2 && !chip; attempt++) {
    await car.page.keyboard.down("ArrowUp");
    for (let i = 0; i < 12 && !chip; i++) {
      await wait(250);
      chip = await car.page.evaluate(() => document.querySelector('[aria-label^="Red light"]')?.textContent ?? null);
    }
    if (!chip) {
      // Facing the other way: turn round and try again.
      await car.page.keyboard.up("ArrowUp");
      await car.page.keyboard.press("ArrowDown");
      await wait(800);
      await untilRed();
    }
  }
  check("driving at a red light: stopped, with the countdown", !!chip && /Red light · \d+ s/.test(chip), chip ?? "");
  await car.page.screenshot({ path: `${OUT}/lights-3-car-red.png` });
  await wait(2000);
  const held = await car.page.evaluate(() => document.querySelector('[aria-label^="Red light"]')?.textContent ?? null);
  check("…still waiting while it's red", !!held, held ?? "");
  // Green: it drives on through the junction.
  const green = signalState(light.signal.group, pageNow()).changesIn + 1500;
  await wait(green);
  await wait(4000);
  await car.page.keyboard.up("ArrowUp");
  await wait(7000); // a save
  const p = await where();
  const toLight = distanceM([p.lng, p.lat], [light.signal.lng, light.signal.lat]);
  const fromStart = distanceM([p.lng, p.lat], [startAt.lng, startAt.lat]);
  // (The chip may be up again: the next light along this road.)
  check("…and on green drives on past it", fromStart > 80 && toLight > 10, `${Math.round(fromStart)} m from the start, ${Math.round(toLight)} m from the light`);
  await car.page.screenshot({ path: `${OUT}/lights-4-car-green.png` });
  check("no page errors (car)", car.problems.length === 0, car.problems.join(" / "));
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
