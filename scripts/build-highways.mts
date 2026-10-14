/**
 * Builds Nigeria's main-road network for long-distance trips (long-distance
 * buses between motor parks): motorways, trunk, primary and secondary roads,
 * from the road squares made by scripts/build-roads.mts, in one small file.
 * Each road keeps its junctions and a simplified shape (within ~25 m).
 *
 *   node scripts/build-highways.mts <roads-dir> <out.json.gz>
 *
 * Upload the result next to the road squares (npm run roads:upload handles
 * only squares; see scripts/upload-highways.mts).
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROAD_FLAGS, decodeRoadCell, type RoadCellFile } from "../src/game/roadData.ts";
import type { HighwayFile } from "../src/game/highways.ts";

const MAIN = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const TOLERANCE_M = 25;

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error("Usage: node scripts/build-highways.mts <roads-dir> <out.json.gz>");
  process.exit(1);
}

type P = { lng: number; lat: number };
const points = new Map<number, P>();
// Each road once (squares overlap at their edges, so the same way can appear in two): keyed by its point ids.
const ways = new Map<string, { ids: number[]; oneway: 0 | 1 | -1 }>();
for (const name of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
  const cell = decodeRoadCell(JSON.parse(gunzipSync(readFileSync(join(dir, name))).toString()) as RoadCellFile);
  const here = new Map(cell.points.map((p) => [p.id, p]));
  for (const w of cell.ways) {
    if (!MAIN.has(w.cls) || w.points.length < 2) continue;
    for (const id of w.points) {
      const p = here.get(id);
      if (p && !points.has(id)) points.set(id, { lng: p.lng, lat: p.lat });
    }
    const oneway = w.flags & ROAD_FLAGS.oneway ? (w.flags & ROAD_FLAGS.onewayBackwards ? -1 : 1) : 0;
    ways.set(`${w.points[0]}:${w.points[w.points.length - 1]}:${w.points.length}`, { ids: w.points, oneway });
  }
}

// Junctions: points used by more than one road, and road ends.
const uses = new Map<number, number>();
for (const w of ways.values()) w.ids.forEach((id, i) => uses.set(id, (uses.get(id) ?? 0) + (i === 0 || i === w.ids.length - 1 ? 2 : 1)));

const distanceM = (a: P, b: P) => Math.hypot((b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110574);
/** Keep the points of a stretch between junctions that its shape needs. */
function simplify(ids: number[]): number[] {
  if (ids.length < 3) return ids;
  const keep = new Uint8Array(ids.length);
  keep[0] = keep[ids.length - 1] = 1;
  const stack: [number, number][] = [[0, ids.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = points.get(ids[i])!;
    const b = points.get(ids[j])!;
    const len = distanceM(a, b) || 1;
    let worst = -1;
    let worstM = TOLERANCE_M;
    for (let k = i + 1; k < j; k++) {
      const p = points.get(ids[k])!;
      // Distance from p to the line a–b (flat, fine at this scale).
      const ax = 0, ay = 0;
      const bx = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), by = (b.lat - a.lat) * 110574;
      const px = (p.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), py = (p.lat - a.lat) * 110574;
      const m = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (m > worstM) {
        worstM = m;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return ids.filter((_, k) => keep[k]);
}

const index = new Map<number, number>();
const lng: number[] = [];
const lat: number[] = [];
const indexOf = (id: number) => {
  let i = index.get(id);
  if (i === undefined) {
    i = lng.length;
    index.set(id, i);
    const p = points.get(id)!;
    lng.push(Math.round(p.lng * 1e5));
    lat.push(Math.round(p.lat * 1e5));
  }
  return i;
};
const roads: number[][] = [];
for (const w of ways.values()) {
  // Split at junctions, simplify each stretch, and join back up.
  const kept: number[] = [];
  let start = 0;
  for (let i = 1; i < w.ids.length; i++) {
    if (i === w.ids.length - 1 || (uses.get(w.ids[i]) ?? 0) > 1) {
      const part = simplify(w.ids.slice(start, i + 1));
      kept.push(...(kept.length ? part.slice(1) : part));
      start = i;
    }
  }
  roads.push([w.oneway, ...kept.map(indexOf)]);
}

// Coordinates delta-encoded (in 1e-5 degrees, ~1 m), like the road squares.
const delta = (values: number[]) => values.map((v, i) => (i ? v - values[i - 1] : v));
const file: HighwayFile = { v: 1, lng: delta(lng), lat: delta(lat), roads };
const gz = gzipSync(JSON.stringify(file));
writeFileSync(out, gz);
console.log(`${roads.length.toLocaleString()} main roads, ${lng.length.toLocaleString()} points; ${(gz.length / 1024 / 1024).toFixed(1)} MB gzipped`);
