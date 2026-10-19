// Two things the owner asked for (19 Oct): (1) the blue route must not hide the traffic: a go-slow on your way shows
// as a red stripe inside the blue line (the page's clock at Monday midday, a route drawn along a real go-slow in
// Yaba/Surulere); (2) the inventory (a backpack) lists your vehicles' gear and papers, and buys what's missing there.
// The test player is deleted.
//   SHOTS=<folder> node --import ./scripts/tests/ts-ext.mjs scripts/tests/route-traffic-inventory-browser-test.mts
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData } from "@/game/roadData";
import * as roads from "@/game/roads";
import { jamOn, trafficLevel } from "@/game/clock";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const OFFSET = Date.parse(process.env.WHEN ?? "2026-10-19T11:00:00Z") - Date.now();
const NL = String.fromCharCode(10);
const ids: string[] = [];
let browser: import("puppeteer-core").Browser | undefined;
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

// The longest go-slow (jam 2) on a main road at the page's time.
const box = { w: 3.355, e: 3.385, s: 6.49, n: 6.53 };
const cells: RoadCellData[] = [];
for (let ix = Math.floor(box.w / ROAD_CELL_DEG); ix <= Math.floor(box.e / ROAD_CELL_DEG); ix++)
  for (let iy = Math.floor(box.s / ROAD_CELL_DEG); iy <= Math.floor(box.n / ROAD_CELL_DEG); iy++) {
    const res = await fetch(`${url}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${roadCellKey(ix, iy)}.json.gz`);
    if (res.ok) cells.push(decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()));
  }
const when = Date.now() + OFFSET + 30_000;
let best: { run: number; points: [number, number][] } = { run: 0, points: [] };
for (const cell of cells) {
  const urban = roads.cellUrban(cell);
  const pts = new Map(cell.points.map((p) => [p.id, p]));
  for (const way of cell.ways) {
    if (way.cls !== "primary" && way.cls !== "trunk" && way.cls !== "secondary") continue;
    let run = 0;
    let points: [number, number][] = [];
    for (let i = 1; i < way.points.length; i++) {
      const a = pts.get(way.points[i - 1]);
      const b = pts.get(way.points[i]);
      if (!a || !b || a.lng < box.w || a.lng > box.e || a.lat < box.s || a.lat > box.n) continue;
      if (jamOn(way.cls, roads.jamStretch(way, a), urban, trafficLevel(when, a.lng, a.lat), when) === 2) {
        if (!points.length) points.push([a.lng, a.lat]);
        run += Math.hypot((b.lng - a.lng) * 110000, (b.lat - a.lat) * 110574);
        points.push([b.lng, b.lat]);
        if (run > best.run) best = { run, points: [...points] };
      } else {
        run = 0;
        points = [];
      }
    }
  }
}
const [lng, lat] = best.points[0];
console.log(`a go-slow of ${Math.round(best.run)} m from ${lng.toFixed(5)}, ${lat.toFixed(5)}`);

try {
  const email = `routejam-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id as string;
  ids.push(id);
  await admin.from("profiles").update({ home_lng: lng, home_lat: lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Route and inventory test" });
  await admin.from("player_positions").upsert({ user_id: id, lng, lat, mode: "motorbike", energy: 90, updated_at: ago(30) });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 100, tyre: 100, engine: 100, lng, lat, in_use: true, helmet: true });
  const jar = new Map<string, string>();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list: { name: string; value: string }[]) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))),
    },
  });
  await c.auth.signInWithPassword({ email, password });
  browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage();
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
    // @ts-expect-error -- the page's clock, moved to Monday midday
    window.Date = Fake;
  }, OFFSET);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);

  // ---- The route along the go-slow: the jam drawn over it
  const order = await page.evaluate((coords: [number, number][]) => {
    const map = (window as unknown as { __lootaMap: import("maplibre-gl").Map }).__lootaMap;
    (map.getSource("route") as import("maplibre-gl").GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });
    const ids = map.getStyle().layers.map((l) => l.id);
    return { traffic: ids.indexOf("traffic"), route: ids.indexOf("route-line"), edge: ids.indexOf("route-edge") };
  }, best.points);
  check("the jams are drawn over the blue route", order.traffic > order.route && order.route > order.edge, JSON.stringify(order));
  await wait(1500);
  const onRoute = await page.evaluate(() => {
    const map = (window as unknown as { __lootaMap: import("maplibre-gl").Map }).__lootaMap;
    const p = map.project(map.getCenter());
    const r = 30;
    const box: [[number, number], [number, number]] = [[p.x - r, p.y - r], [p.x + r, p.y + r]];
    return {
      route: map.queryRenderedFeatures(box, { layers: ["route-line"] }).length,
      jam: Math.max(0, ...map.queryRenderedFeatures(box, { layers: ["traffic"] }).map((f) => Number(f.properties?.jam ?? 0))),
    };
  });
  check("…here: the route and a go-slow on it, both drawn", onRoute.route > 0 && onRoute.jam === 2, JSON.stringify(onRoute));
  await page.screenshot({ path: `${OUT}/routejam-1.png` });

  // ---- The inventory: a backpack, with the motorbike's gear and papers
  const inv = await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('button[aria-label^="Inventory"]');
    b?.click();
    return !!b;
  });
  check("an Inventory button", inv);
  await wait(1500);
  const text = await page.evaluate((nl: string) => document.querySelector('[role="dialog"][aria-label="Inventory"]')?.textContent?.split(nl).join(" | ") ?? null, NL);
  check(
    "…gear and papers: the helmet ✓, the licence and registration to buy",
    /Helmet✓ Got it/.test(text ?? "") && /Rider's licence\+ Buy · 150 coins/.test(text ?? "") && /Registration \(plate number\)\+ Buy · 200 coins/.test(text ?? ""),
    text?.slice(0, 300),
  );
  await page.screenshot({ path: `${OUT}/routejam-2-inventory.png` });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Inventory"] button')].find((b) => b.textContent?.includes("Rider's licence"))?.click());
  await wait(3000);
  const after = await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Inventory"]')?.textContent ?? "");
  const licence = (await admin.from("profiles").select("rider_licence, coins").eq("id", id).single()).data;
  check("…the rider's licence bought there: ✓, 150 coins", licence.rider_licence === true && licence.coins === 350 && /Rider's licence✓ Got it/.test(after), JSON.stringify(licence));
  await page.screenshot({ path: `${OUT}/routejam-3-licence.png` });
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
