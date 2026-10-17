// How long are traffic jams on the roads around a spot, and how long does a motorbike or car spend in one?
// Uses the jam rules in src/game/clock.ts at the evening rush (level 1).
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/jam-check.mts <lng> <lat>
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData } from "@/game/roadData";
import * as roads from "@/game/roads";
import { distanceM } from "@/game/geo";
import { jamOn, jamSpeed } from "@/game/clock";
import { MODES, TIME_SCALE } from "@/game/movement";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const [lng, lat] = process.argv.slice(2).map(Number);
const keys: string[] = [];
for (let ix = Math.floor((lng - 0.01) / ROAD_CELL_DEG); ix <= Math.floor((lng + 0.01) / ROAD_CELL_DEG); ix++)
  for (let iy = Math.floor((lat - 0.01) / ROAD_CELL_DEG); iy <= Math.floor((lat + 0.01) / ROAD_CELL_DEG); iy++) keys.push(roadCellKey(ix, iy));
const cells: RoadCellData[] = [];
for (const key of keys) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
  if (res.ok) cells.push(decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()));
}
const net = roads.buildNetworkFromCells(cells, "car", { lng, lat });

// Group the network's pieces by stretch: total length, class, how built-up.
const stretches = new Map<number, { m: number; cls: string; urban: number }>();
for (const e of net.edges) {
  if (e.cls === undefined) continue;
  const a = net.nodes[e.a], b = net.nodes[e.b];
  const m = distanceM([a.lng, a.lat], [b.lng, b.lat]);
  const s = stretches.get(e.stretch ?? 0) ?? { m: 0, cls: e.cls, urban: e.urban ?? 0 };
  s.m += m;
  stretches.set(e.stretch ?? 0, s);
}
const busy = [...stretches.values()].filter((s) => ["trunk", "primary", "secondary", "motorway"].includes(s.cls));
const lengths = busy.map((s) => s.m).sort((x, y) => x - y);
// The jam you'd drive into: the stretch a random metre of main road belongs to (weighted by length).
const total = lengths.reduce((a, b) => a + b, 0);
let run = 0;
const median = lengths.find((m) => (run += m) >= total / 2) ?? 0;
console.log(`main-road stretches near ${lng}, ${lat}: ${busy.length}; median length ${Math.round(median)} m, longest ${Math.round(lengths.at(-1) ?? 0)} m`);
const now = Date.now();
let jammed = 0, standstill = 0;
for (const [id, s] of stretches) {
  if (!["trunk", "primary", "secondary", "motorway"].includes(s.cls)) continue;
  const j = jamOn(s.cls as never, id, s.urban, 1, now);
  if (j > 0) jammed++;
  if (j === 2) standstill++;
}
console.log(`at the evening rush: ${jammed} of ${busy.length} jammed, ${standstill} at a standstill`);
for (const mode of ["motorbike", "car"] as const) {
  const free = (MODES[mode].kmh / 3.6) * TIME_SCALE; // map metres a real second
  const slow = free * jamSpeed(mode, 2);
  console.log(`${mode}: ${Math.round(free)} m/s free, ${Math.round(slow)} m/s at a standstill → a ${Math.round(median)} m jam takes ${(median / slow).toFixed(1)} s (free: ${(median / free).toFixed(1)} s)`);
}
