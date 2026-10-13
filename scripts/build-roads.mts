/**
 * Builds our own road squares from an OpenStreetMap extract (design decision
 * 13 Oct 2026; see src/game/roadData.ts for the file format).
 *
 *   node --max-old-space-size=4096 scripts/build-roads.mts <extract.osm.pbf> <out-dir> [west,south,east,north]
 *
 * Get the extract from https://download.geofabrik.de/africa/nigeria-latest.osm.pbf
 * (updated daily; rebuild about monthly). The optional box limits which squares
 * are written. Two passes over the file: first the roads, then only the points
 * those roads use. Writes one gzipped JSON file per square plus manifest.json.
 */
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ROAD_CELL_DEG, ROAD_CLASSES, ROAD_FLAGS, roadCellKey, type RoadCellFile } from "../src/game/roadData.ts";

const require = createRequire(import.meta.url);
const parse = require("osm-pbf-parser") as () => NodeJS.ReadWriteStream;

type OsmItem =
  | { type: "node"; id: number; lat: number; lon: number }
  | { type: "way"; id: number; tags: Record<string, string>; refs: number[] }
  | { type: "relation" };

const [input, outDir, boxArg] = process.argv.slice(2);
if (!input || !outDir) {
  console.error("Usage: node scripts/build-roads.mts <extract.osm.pbf> <out-dir> [west,south,east,north]");
  process.exit(1);
}
const box = boxArg ? boxArg.split(",").map(Number) : null;
const classIndex = new Map<string, number>(ROAD_CLASSES.map((c, i) => [c, i]));
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

// A growable typed array (millions of values, without per-value JS objects).
class Grow<T extends Float64Array | Int32Array | Uint8Array> {
  length = 0;
  data: T;
  constructor(data: T) {
    this.data = data;
  }
  push(v: number) {
    if (this.length === this.data.length) {
      const bigger = new (this.data.constructor as { new (n: number): T })(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = v;
  }
}

// ---- Pass 1: the roads --------------------------------------------------
const wayClass = new Grow(new Uint8Array(1 << 20));
const wayFlags = new Grow(new Uint8Array(1 << 20));
const wayName = new Grow(new Int32Array(1 << 20));
const wayStart = new Grow(new Int32Array(1 << 20));
const refs = new Grow(new Float64Array(1 << 24));
const names: string[] = [];
const nameIndex = new Map<string, number>();

await readAll((item) => {
  if (item.type !== "way") return;
  const t = item.tags;
  const cls = classIndex.get(t.highway);
  if (cls === undefined || item.refs.length < 2) return;
  if (t.area === "yes") return; // squares and plazas drawn as outlines
  let flags = 0;
  if (t.bridge && t.bridge !== "no") flags |= ROAD_FLAGS.bridge;
  if (t.tunnel && t.tunnel !== "no") flags |= ROAD_FLAGS.tunnel;
  if (t.oneway === "yes" || t.oneway === "1" || t.oneway === "true") flags |= ROAD_FLAGS.oneway;
  if (t.oneway === "-1") flags |= ROAD_FLAGS.onewayBackwards;
  if (t.access === "private" || t.access === "no") flags |= ROAD_FLAGS.private;
  const name = t.name?.trim();
  let n = -1;
  if (name) {
    n = nameIndex.get(name) ?? -1;
    if (n < 0) {
      n = names.length;
      names.push(name);
      nameIndex.set(name, n);
    }
  }
  wayClass.push(cls);
  wayFlags.push(flags);
  wayName.push(n);
  wayStart.push(refs.length);
  for (const r of item.refs) refs.push(r);
});
const wayCount = wayClass.length;
wayStart.push(refs.length); // so way w uses refs[wayStart[w] .. wayStart[w + 1])
console.log(`pass 1: ${wayCount.toLocaleString()} roads, ${refs.length.toLocaleString()} points used (${elapsed()})`);

// The points the roads use, sorted and without repeats.
const needed = Float64Array.from(refs.data.subarray(0, refs.length)).sort();
let unique = 0;
for (let i = 0; i < needed.length; i++) if (i === 0 || needed[i] !== needed[i - 1]) needed[unique++] = needed[i];
const ids = needed.subarray(0, unique);
const lngE6 = new Int32Array(unique);
const latE6 = new Int32Array(unique);
const found = new Uint8Array(unique);
const indexOf = (id: number) => {
  let lo = 0;
  let hi = unique - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ids[mid] === id) return mid;
    if (ids[mid] < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
};
console.log(`${unique.toLocaleString()} different points needed (${elapsed()})`);

// ---- Pass 2: where those points are --------------------------------------
// Extracts list nodes by increasing id, so walk the sorted list alongside them.
let cursor = 0;
let lastId = -Infinity;
await readAll((item) => {
  if (item.type !== "node") return;
  let i: number;
  if (item.id >= lastId) {
    while (cursor < unique && ids[cursor] < item.id) cursor++;
    i = cursor < unique && ids[cursor] === item.id ? cursor : -1;
  } else {
    i = indexOf(item.id); // out of order (unusual): search
  }
  lastId = item.id;
  if (i < 0) return;
  lngE6[i] = Math.round(item.lon * 1e6);
  latE6[i] = Math.round(item.lat * 1e6);
  found[i] = 1;
});
let missing = 0;
for (let i = 0; i < unique; i++) if (!found[i]) missing++;
console.log(`pass 2: coordinates found (${missing.toLocaleString()} missing) (${elapsed()})`);

// Each road's points as indices into `ids`.
const refIdx = new Int32Array(refs.length);
// refs aren't sorted, so search each (fast enough: a few seconds).
for (let i = 0; i < refs.length; i++) refIdx[i] = indexOf(refs.data[i]);
console.log(`linked ${refIdx.length.toLocaleString()} road points (${elapsed()})`);

// ---- Cut into squares ---------------------------------------------------
const cellX = (p: number) => Math.floor(lngE6[p] / 1e6 / ROAD_CELL_DEG);
const cellY = (p: number) => Math.floor(latE6[p] / 1e6 / ROAD_CELL_DEG);
const inBox = (ix: number, iy: number) =>
  !box || ((ix + 1) * ROAD_CELL_DEG > box[0] && iy * ROAD_CELL_DEG < box[3] && ix * ROAD_CELL_DEG < box[2] && (iy + 1) * ROAD_CELL_DEG > box[1]);

// Group the work by 1° blocks so only one block's squares are in memory at once.
const PER_BLOCK = Math.round(1 / ROAD_CELL_DEG);
const blockOf = (i: number) => Math.floor(i / PER_BLOCK);
const blocks = new Map<string, number[]>(); // block → roads touching it
for (let w = 0; w < wayCount; w++) {
  const seen = new Set<string>();
  for (let r = wayStart.data[w]; r < wayStart.data[w + 1]; r++) {
    const p = refIdx[r];
    if (p < 0 || !found[p]) continue;
    const key = `${blockOf(cellX(p))}_${blockOf(cellY(p))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = blocks.get(key);
    if (list) list.push(w);
    else blocks.set(key, [w]);
  }
}
console.log(`${blocks.size} one-degree blocks with roads (${elapsed()})`);

mkdirSync(outDir, { recursive: true });
const written: string[] = [];
let bytes = 0;
for (const [blockKey, roadsInBlock] of blocks) {
  const [bx, by] = blockKey.split("_").map(Number);
  // Square → pieces of road: runs of consecutive points whose segments touch the square
  // (a segment crossing a boundary goes in both squares, so pieces join up by point id).
  const pieces = new Map<string, { w: number; points: number[] }[]>();
  for (const w of roadsInBlock) {
    const open = new Map<string, number[]>();
    const close = (key: string) => {
      const run = open.get(key);
      if (!run) return;
      open.delete(key);
      const list = pieces.get(key);
      if (list) list.push({ w, points: run });
      else pieces.set(key, [{ w, points: run }]);
    };
    for (let r = wayStart.data[w] + 1; r < wayStart.data[w + 1]; r++) {
      const a = refIdx[r - 1];
      const b = refIdx[r];
      if (a < 0 || b < 0 || !found[a] || !found[b]) {
        for (const key of [...open.keys()]) close(key);
        continue;
      }
      const touch = new Set<string>();
      for (const p of [a, b]) {
        const ix = cellX(p);
        const iy = cellY(p);
        if (blockOf(ix) === bx && blockOf(iy) === by && inBox(ix, iy)) touch.add(roadCellKey(ix, iy));
      }
      for (const key of [...open.keys()]) if (!touch.has(key)) close(key);
      for (const key of touch) {
        const run = open.get(key);
        if (run && run[run.length - 1] === a) run.push(b);
        else {
          close(key);
          open.set(key, [a, b]);
        }
      }
    }
    for (const key of [...open.keys()]) close(key);
  }

  for (const [key, list] of pieces) {
    const used = [...new Set(list.flatMap((p) => p.points))].sort((x, y) => ids[x] - ids[y]);
    const local = new Map(used.map((p, i) => [p, i]));
    const cellNames: string[] = [];
    const cellNameIdx = new Map<number, number>();
    const file: RoadCellFile = { v: 1, ids: [], lng: [], lat: [], names: cellNames, ways: [] };
    let pid = 0;
    let plng = 0;
    let plat = 0;
    for (const p of used) {
      file.ids.push(ids[p] - pid);
      file.lng.push(lngE6[p] - plng);
      file.lat.push(latE6[p] - plat);
      pid = ids[p];
      plng = lngE6[p];
      plat = latE6[p];
    }
    for (const { w, points } of list) {
      let n = -1;
      const global = wayName.data[w];
      if (global >= 0) {
        n = cellNameIdx.get(global) ?? -1;
        if (n < 0) {
          n = cellNames.length;
          cellNames.push(names[global]);
          cellNameIdx.set(global, n);
        }
      }
      file.ways.push([wayClass.data[w], n, wayFlags.data[w], points.map((p) => local.get(p)!)]);
    }
    const gz = gzipSync(JSON.stringify(file), { level: 9 });
    writeFileSync(join(outDir, `${key}.json.gz`), gz);
    written.push(key);
    bytes += gz.length;
  }
}
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify({ v: 1, cellDeg: ROAD_CELL_DEG, built: new Date().toISOString(), source: input.split(/[\\/]/).pop(), cells: written.sort() }),
);
console.log(`wrote ${written.length.toLocaleString()} squares, ${(bytes / 1024 / 1024).toFixed(1)} MB in all (${elapsed()})`);
