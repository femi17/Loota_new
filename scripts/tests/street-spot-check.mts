// Where a bike renter waits (roads.streetSpot): in a side street, never by a highway or a main road. Checked from
// the owner's spot on the Apapa-Oworonshoki Expressway (18 Oct 2026: the renter was on the expressway) and from
// a few other main roads in Lagos, on our own road data.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/street-spot-check.mts
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData } from "@/game/roadData";
import * as roads from "@/game/roads";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};
const cache = new Map<string, RoadCellData | null>();
async function cellsAround(lng: number, lat: number) {
  const out: RoadCellData[] = [];
  for (let ix = Math.floor((lng - 0.02) / ROAD_CELL_DEG); ix <= Math.floor((lng + 0.02) / ROAD_CELL_DEG); ix++)
    for (let iy = Math.floor((lat - 0.02) / ROAD_CELL_DEG); iy <= Math.floor((lat + 0.02) / ROAD_CELL_DEG); iy++) {
      const key = roadCellKey(ix, iy);
      if (!cache.has(key)) {
        const res = await fetch(`${url}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
        cache.set(key, res.ok ? decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()) : null);
      }
      const c = cache.get(key);
      if (c) out.push(c);
    }
  return out;
}
/** A point on the named road (the one nearest the given spot). */
async function onRoad(name: RegExp, near: { lng: number; lat: number }) {
  let best: { lng: number; lat: number; d: number } | null = null;
  for (const cell of await cellsAround(near.lng, near.lat)) {
    const pts = new Map(cell.points.map((p) => [p.id, p]));
    for (const way of cell.ways) {
      if (!way.name || !name.test(way.name)) continue;
      for (const id of way.points) {
        const p = pts.get(id)!;
        const d = Math.hypot((p.lng - near.lng) * 110400, (p.lat - near.lat) * 110574);
        if (!best || d < best.d) best = { lng: p.lng, lat: p.lat, d };
      }
    }
  }
  return best;
}
const MAIN = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
for (const [label, road, near] of [
  ["the owner's spot: Apapa-Oworonshoki Expressway by Otunba Sobowale Street", /Oworonsh?oki Expressway/, { lng: 3.392, lat: 6.556 }],
  ["Ikorodu Road, Fadeyi", /Ikorodu Road/, { lng: 3.372, lat: 6.528 }],
  ["Third Mainland Bridge's end at Oworonshoki", /Third Mainland/, { lng: 3.401, lat: 6.551 }],
  ["Herbert Macaulay Way, Yaba", /Herbert Macaulay/, { lng: 3.379, lat: 6.507 }],
] as const) {
  const at = await onRoad(road, near);
  if (!at) {
    check(label, false, "road not found");
    continue;
  }
  const cells = await cellsAround(at.lng, at.lat);
  const net = roads.buildNetworkFromCells(cells, "walk", at, 1500);
  const spot = roads.streetSpot(net, at);
  if (!spot) {
    check(label, false, "no street spot");
    continue;
  }
  // How far the spot is from any main road (on the full data, not just the network).
  let clear = Infinity;
  for (const cell of cells) {
    const pts = new Map(cell.points.map((p) => [p.id, p]));
    for (const way of cell.ways) {
      if (!MAIN.has(way.cls)) continue;
      for (let i = 1; i < way.points.length; i++) {
        const a = pts.get(way.points[i - 1])!, b = pts.get(way.points[i])!;
        const kx = 111320 * Math.cos((spot.lat * Math.PI) / 180), ky = 110574;
        const ax = (a.lng - spot.lng) * kx, ay = (a.lat - spot.lat) * ky, bx = (b.lng - spot.lng) * kx, by = (b.lat - spot.lat) * ky;
        const dx = bx - ax, dy = by - ay;
        const f = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-9)));
        clear = Math.min(clear, Math.hypot(ax + dx * f, ay + dy * f));
      }
    }
  }
  check(`${label}: the renter waits in a side street`, clear >= 35 && spot.metres <= 600, `${spot.name ?? "a side street"}, ${Math.round(spot.metres)} m away, ${Math.round(clear)} m from the nearest main road`);
}
console.log(fails ? `${fails} FAILED` : "all passed");
