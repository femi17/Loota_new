// Can our own roads take a player from a spot to the nearest places of a kind (fuel, eat, …)? Prints, for each of the
// nearest 5, the straight-line distance, the road route found (or none) and how far the route ends from the place.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/route-to-check.mts <lng> <lat> [kind=fuel] [mode=walk]
import { createRequire } from "node:module";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData } from "@/game/roadData";
import * as roads from "@/game/roads";
import { distanceM } from "@/game/geo";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [lng, lat] = process.argv.slice(2, 4).map(Number);
const kind = process.argv[4] ?? "fuel";
const mode = (process.argv[5] ?? "walk") as import("@/game/movement").Mode;
const { data: places } = await admin.from("places").select("id,name,lng,lat").eq("kind", kind)
  .gte("lng", lng - 0.1).lte("lng", lng + 0.1).gte("lat", lat - 0.1).lte("lat", lat + 0.1);
const near = (places ?? []).map((p: { id: number; name: string; lng: number; lat: number }) => ({ ...p, d: distanceM([lng, lat], [p.lng, p.lat]) }))
  .sort((a: { d: number }, b: { d: number }) => a.d - b.d).slice(0, 5);
const cache = new Map<string, RoadCellData | null>();
async function cell(k: string) {
  if (!cache.has(k)) {
    const res = await fetch(`${url}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${k}.json.gz`);
    cache.set(k, res.ok ? decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()) : null);
  }
  return cache.get(k);
}
for (const p of near) {
  let result = "no route";
  for (const margin of [0.01, 0.03]) {
    const keys: string[] = [];
    for (let ix = Math.floor((Math.min(lng, p.lng) - margin) / ROAD_CELL_DEG); ix <= Math.floor((Math.max(lng, p.lng) + margin) / ROAD_CELL_DEG); ix++)
      for (let iy = Math.floor((Math.min(lat, p.lat) - margin) / ROAD_CELL_DEG); iy <= Math.floor((Math.max(lat, p.lat) + margin) / ROAD_CELL_DEG); iy++) keys.push(roadCellKey(ix, iy));
    const cells = (await Promise.all(keys.map(cell))).filter((c): c is RoadCellData => !!c);
    const net = roads.buildNetworkFromCells(cells, mode, { lng: (lng + p.lng) / 2, lat: (lat + p.lat) / 2 }, Infinity);
    let start = roads.snapToNetwork(net, { lng, lat }, 0);
    if (start && roads.cutOffEdges(net)[start.edge]) start = roads.snapToNetwork(net, { lng, lat }, 0, roads.cutOffEdges(net)) ?? start;
    const path = start ? roads.findPath(net, start, p, 300) : null;
    if (path) {
      let len = 0;
      for (let i = 1; i < path.length; i++) len += distanceM(path[i - 1], path[i]);
      const end = path[path.length - 1];
      result = `route ${Math.round(len)} m (margin ${margin}), ends ${Math.round(distanceM(end, [p.lng, p.lat]))} m from it`;
      break;
    }
  }
  console.log(`${p.name} (#${p.id}) ${Math.round(p.d)} m straight: ${result}`);
}
