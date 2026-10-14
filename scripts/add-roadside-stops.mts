/**
 * Adds roadside bus stops to the transport data. OpenStreetMap has few bus
 * stops in Nigeria (about 140 in all of Lagos), but buses there stop
 * anywhere along a main road; so every ~700 m of trunk, primary and secondary
 * road gets a stop, named after the road, unless a mapped stop is close by.
 *
 *   node scripts/add-roadside-stops.mts <roads-dir> <transit.json>
 *
 * <roads-dir> is the output of scripts/build-roads.mts; <transit.json> (from
 * scripts/build-transit.mts) is updated in place. Run it before transit:upload.
 */
import { gunzipSync } from "node:zlib";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeRoadCell, type RoadCellFile } from "../src/game/roadData.ts";

type Stop = { name: string; lng: number; lat: number; park: boolean; roadside?: boolean };

const SPACING_M = 700;
const CLEAR_OF_MAPPED_M = 350; // no roadside stop this close to a mapped stop
const CLEAR_OF_ROADSIDE_M = 450; // or to another roadside stop (roads crossing, both directions)
const MAIN = new Set(["trunk", "primary", "secondary"]);

const [dir, file] = process.argv.slice(2);
if (!dir || !file) {
  console.error("Usage: node scripts/add-roadside-stops.mts <roads-dir> <transit.json>");
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, "utf8")) as { buses: Stop[] };
const mapped = data.buses.filter((b) => !b.roadside);

function distanceM(a: [number, number], b: [number, number]) {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * 111320 * k, (b[1] - a[1]) * 110574);
}

// Stops bucketed by ~0.01° squares for quick "anything close by?" checks.
const BUCKET = 0.01;
const buckets = new Map<string, Stop[]>();
const bucketKey = (lng: number, lat: number) => `${Math.floor(lng / BUCKET)}_${Math.floor(lat / BUCKET)}`;
const addToBucket = (s: Stop) => {
  const key = bucketKey(s.lng, s.lat);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key)!.push(s);
};
const clear = (lng: number, lat: number) => {
  const bx = Math.floor(lng / BUCKET);
  const by = Math.floor(lat / BUCKET);
  for (let x = bx - 1; x <= bx + 1; x++) {
    for (let y = by - 1; y <= by + 1; y++) {
      for (const s of buckets.get(`${x}_${y}`) ?? []) {
        if (distanceM([lng, lat], [s.lng, s.lat]) < (s.roadside ? CLEAR_OF_ROADSIDE_M : CLEAR_OF_MAPPED_M)) return false;
      }
    }
  }
  return true;
};
mapped.forEach(addToBucket);

const added: Stop[] = [];
const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
for (const name of files) {
  const cell = decodeRoadCell(JSON.parse(gunzipSync(readFileSync(join(dir, name))).toString()) as RoadCellFile);
  const at = new Map(cell.points.map((p) => [p.id, p]));
  // Named streets' points, for naming a stop on an unnamed stretch of main road.
  const named = cell.ways.flatMap((w) => (w.name ? w.points.map((id) => ({ p: at.get(id), name: w.name! })) : []));
  const nameNear = (lng: number, lat: number) => {
    let best: string | null = null;
    let bestM = 150;
    for (const { p, name: n } of named) {
      if (!p) continue;
      const m = distanceM([lng, lat], [p.lng, p.lat]);
      if (m < bestM) {
        bestM = m;
        best = n;
      }
    }
    return best;
  };
  for (const way of cell.ways) {
    if (!MAIN.has(way.cls)) continue;
    let run = SPACING_M / 2; // the first stop half a spacing in, so the ends of short pieces get one
    for (let i = 1; i < way.points.length; i++) {
      const a = at.get(way.points[i - 1]);
      const b = at.get(way.points[i]);
      if (!a || !b) continue;
      const seg = distanceM([a.lng, a.lat], [b.lng, b.lat]);
      let d = SPACING_M - run;
      while (d <= seg) {
        const f = d / seg;
        const lng = a.lng + (b.lng - a.lng) * f;
        const lat = a.lat + (b.lat - a.lat) * f;
        if (clear(lng, lat)) {
          const roadName = way.name ?? nameNear(lng, lat);
          const stop: Stop = { name: roadName ? `${roadName} bus stop` : "Roadside bus stop", lng: +lng.toFixed(6), lat: +lat.toFixed(6), park: false, roadside: true };
          added.push(stop);
          addToBucket(stop);
        }
        d += SPACING_M;
      }
      run = (run + seg) % SPACING_M;
    }
  }
}

data.buses = [...mapped, ...added];
writeFileSync(file, JSON.stringify(data));
console.log(`${mapped.length} mapped bus stops kept, ${added.length} roadside stops added (${files.length} road squares read).`);
