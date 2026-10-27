/**
 * Builds the places that keep travellers going (design doc 5.3, 5.6): petrol
 * stations, hospitals and clinics, places to eat, places to rest (parks and
 * gardens), tyre shops (vulcanizers) and mechanics, from an OpenStreetMap
 * extract. The game sends players to the nearest one, and the server checks
 * they're really there before selling fuel, a meal, a pump or a repair.
 *
 *   node --max-old-space-size=4096 scripts/build-places.mts <extract.osm.pbf> <out.json>
 *
 * Then `npm run places:upload -- <out.json>`. Three passes over the file:
 * tagged nodes and the ways that are places, then the points of those ways.
 */
import { createReadStream, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const parse = require("osm-pbf-parser") as () => NodeJS.ReadWriteStream;

import { kindOf, nameOf, type PlaceKind, type Tags } from "../src/lib/osm-places.ts";

type OsmItem =
  | { type: "node"; id: number; lat: number; lon: number; tags?: Tags }
  | { type: "way"; id: number; tags: Tags; refs: number[] }
  | { type: "relation" };
export type { PlaceKind };

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/build-places.mts <extract.osm.pbf> <out.json>");
  process.exit(1);
}
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
function readAll(onItem: (item: OsmItem) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(input)
      .pipe(parse())
      .on("data", (items: OsmItem[]) => items.forEach(onItem))
      .on("end", resolve)
      .on("error", reject);
  });
}

type Place = { kind: PlaceKind; name: string; lng: number; lat: number };
const places: Place[] = [];
const areas: { kind: PlaceKind; name: string; refs: number[] }[] = [];
const needed = new Set<number>();

await readAll((it) => {
  if (it.type === "node") {
    const k = it.tags ? kindOf(it.tags) : null;
    if (k) places.push({ kind: k, name: nameOf(it.tags!, k), lng: it.lon, lat: it.lat });
  } else if (it.type === "way") {
    const k = kindOf(it.tags);
    if (!k) return;
    areas.push({ kind: k, name: nameOf(it.tags, k), refs: it.refs });
    it.refs.forEach((r) => needed.add(r));
  }
});
console.log(`pass 1 done in ${elapsed()}: ${places.length} points, ${areas.length} areas`);

const coords = new Map<number, [number, number]>();
await readAll((it) => {
  if (it.type === "node" && needed.has(it.id)) coords.set(it.id, [it.lon, it.lat]);
});
for (const a of areas) {
  const pts = a.refs.map((r) => coords.get(r)).filter((p): p is [number, number] => !!p);
  if (!pts.length) continue;
  places.push({ kind: a.kind, name: a.name, lng: pts.reduce((s, p) => s + p[0], 0) / pts.length, lat: pts.reduce((s, p) => s + p[1], 0) / pts.length });
}

// The same place mapped as a point and an outline: keep one.
const seen = new Set<string>();
const unique = places.filter((p) => {
  const key = `${p.kind}:${Math.round(p.lng * 2000)}:${Math.round(p.lat * 2000)}`; // ~50 m
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
const rounded = unique.map((p) => ({ ...p, name: p.name.slice(0, 80), lng: +p.lng.toFixed(6), lat: +p.lat.toFixed(6) }));
writeFileSync(output, JSON.stringify({ built: new Date().toISOString(), places: rounded }));
const counts: Record<string, number> = {};
for (const p of rounded) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
console.log(`done in ${elapsed()}: ${rounded.length} places`, counts);
