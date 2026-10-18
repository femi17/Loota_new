// Does a car's speed in traffic follow the jams drawn on the map? (phone; the page's clock at Monday midday, when jams
// are patchy, or WHEN=<ISO time>)
// A car starts in the middle of a go-slow in Yaba/Surulere and drives on for a minute; several times a second the
// jam drawn under the car (within 12 m: the car covers that much of the map) is compared with the jam the car is
// held up by. (Owner, 18 Oct 2026: the car sped off on an unnamed slip road inside a red go-slow.) The test player is deleted.
//   SHOTS=<folder> node --import ./scripts/tests/ts-ext.mjs scripts/tests/goslow-probe-browser-test.mts
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
const ids: string[] = [];
let browser: import("puppeteer-core").Browser | undefined;
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

// A go-slow (jam 2) on a main road, at the page's time: the start of its longest run of jammed segments.
const box = { w: 3.355, e: 3.385, s: 6.49, n: 6.53 };
const cells: RoadCellData[] = [];
for (let ix = Math.floor(box.w / ROAD_CELL_DEG); ix <= Math.floor(box.e / ROAD_CELL_DEG); ix++)
  for (let iy = Math.floor(box.s / ROAD_CELL_DEG); iy <= Math.floor(box.n / ROAD_CELL_DEG); iy++) {
    const res = await fetch(`${url}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${roadCellKey(ix, iy)}.json.gz`);
    if (res.ok) cells.push(decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()));
  }
const when = Date.now() + OFFSET + 30_000;
let start: { lng: number; lat: number; name: string | null; run: number; points: { lng: number; lat: number; s: number }[] } | null = null;
for (const cell of cells) {
  const urban = roads.cellUrban(cell);
  const pts = new Map(cell.points.map((p) => [p.id, p]));
  for (const way of cell.ways) {
    if (way.cls !== "primary" && way.cls !== "trunk" && way.cls !== "secondary") continue;
    let run = 0;
    let first: { lng: number; lat: number } | null = null;
    let points: { lng: number; lat: number; s: number }[] = [];
    for (let i = 1; i < way.points.length; i++) {
      const a = pts.get(way.points[i - 1])!;
      const b = pts.get(way.points[i])!;
      if (!a || !b || a.lng < box.w || a.lng > box.e || a.lat < box.s || a.lat > box.n) continue;
      const jam = jamOn(way.cls, roads.jamStretch(way, a), urban, trafficLevel(when, a.lng, a.lat), when);
      if (jam === 2) {
        first ??= a;
        if (!points.length) points.push({ ...a, s: 0 });
        run += Math.hypot((b.lng - a.lng) * 110000, (b.lat - a.lat) * 110574);
        points.push({ ...b, s: run });
        if (!start || run > start.run) start = { ...first, name: way.name, run, points: [...points] };
      } else {
        run = 0;
        first = null;
        points = [];
      }
    }
  }
}
// Start in the middle of it: whichever way the car faces, it drives out onto free road within the minute.
const mid = start!.points.find((p) => p.s >= start!.run / 2)!;
start!.lng = mid.lng;
start!.lat = mid.lat;
console.log(`a go-slow on ${start?.name ?? "an unnamed road"}: ${Math.round(start?.run ?? 0)} m from ${start?.lng.toFixed(5)}, ${start?.lat.toFixed(5)}`);

try {
  const email = `goslow-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id as string;
  ids.push(id);
  const at = start!;
  await admin.from("profiles").update({ home_lng: at.lng, home_lat: at.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "car", energy: 90, updated_at: ago(30) });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "car", fuel: 100, tyre: 100, engine: 100, lng: at.lng, lat: at.lat, in_use: true });
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
    // @ts-expect-error -- the page's clock, moved to the rush hour
    window.Date = Fake;
  }, OFFSET);
  await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(20000);

  type Sample = { t: number; lng: number; lat: number; drawn: number; drawnAround: number; held: number; kmh: number | null; roads: string };
  const probe = () =>
    page.evaluate(() => {
      const map = (window as unknown as { __lootaMap: import("maplibre-gl").Map }).__lootaMap;
      const c = map.getCenter();
      const p = map.project(c);
      // The jam drawn around the car: within the square inside its 12 m circle, and the square around it.
      const px = 12 / ((40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom()));
      const jamIn = (r: number) =>
        Math.max(0, ...map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ["traffic"] }).map((x) => Number(x.properties?.jam ?? 0)));
      const drawn = jamIn(px / Math.SQRT2);
      const drawnAround = jamIn(px);
      const chip = document.querySelector('[aria-label="Traffic jam: at a standstill"], [aria-label="Slow traffic"]')?.textContent ?? "";
      const held = /Go-slow/.test(chip) ? 2 : /Slow traffic/.test(chip) ? 1 : 0;
      const kmh = chip.match(/· (\d+) of/)?.[1];
      return { lng: c.lng, lat: c.lat, drawn, drawnAround, held, kmh: kmh ? Number(kmh) : null, roads: document.querySelector("[data-roads]")?.getAttribute("data-roads") ?? "" };
    });
  const samples: Sample[] = [];
  const t0 = Date.now();
  await page.keyboard.down("ArrowUp");
  let shot = 0;
  while (Date.now() - t0 < 60_000) {
    const s = await probe();
    samples.push({ t: Date.now() - t0, ...s });
    const last = samples.at(-2);
    if (last && last.drawn !== s.drawn && shot < 4) await page.screenshot({ path: `${OUT}/goslow-${++shot}.png` });
    await wait(250);
  }
  await page.keyboard.up("ArrowUp");
  // A sample disagrees when the car is held up less than the jam drawn right under it, or more than any drawn around it.
  const fits = (s: Sample) => s.held >= s.drawn && s.held <= s.drawnAround;
  const off = samples.filter((s, i) => {
    if (fits(s)) return false;
    // (The car checks 5 times a second: a moment at the edge of a jam is fine.)
    return !samples.slice(Math.max(0, i - 2), i + 3).some((n) => n !== s && n.held === s.held && fits({ ...s, drawn: n.drawn, drawnAround: n.drawnAround }));
  });
  console.log(`${samples.length} samples; drawn jam under the car: ${[0, 1, 2].map((j) => `${j}: ${samples.filter((s) => s.drawn === j).length}`).join(", ")}`);
  console.log(`free road reached: ${samples.some((s) => s.drawnAround === 0) ? "yes" : "no"}; the car went fast there: ${samples.filter((s) => s.drawnAround === 0).every((s) => s.held === 0) ? "yes" : "no"}`);
  for (const s of off.slice(0, 12)) console.log(`   off at ${(s.t / 1000).toFixed(1)} s: drawn ${s.drawn} (around ${s.drawnAround}), car held by ${s.held}${s.kmh ? ` (${s.kmh} km/h)` : ""} · ${s.lng.toFixed(5)}, ${s.lat.toFixed(5)} · ${s.roads}`);
  check("the car is held up exactly where the map draws the jam, and only there", off.length === 0 && samples.some((s) => s.drawnAround === 0), `${off.length} of ${samples.length} samples off`);
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
