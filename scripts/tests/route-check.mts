// Can the game route between two points on our own roads (the way routeOnOwnRoads does)?
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/route-check.mts <fromLng> <fromLat> <toLng> <toLat> [mode]
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData } from "@/game/roadData";
import * as roads from "@/game/roads";
import { distanceM } from "@/game/geo";
import type { Mode } from "@/game/movement";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const [fl, fa, tl, ta] = process.argv.slice(2, 6).map(Number);
const mode = (process.argv[6] ?? "walk") as Mode;
const from = { lng: fl, lat: fa }, to = { lng: tl, lat: ta };
const M = Number(process.env.MARGIN ?? 0.01);
const keys: string[] = [];
for (let ix = Math.floor((Math.min(fl, tl) - M) / ROAD_CELL_DEG); ix <= Math.floor((Math.max(fl, tl) + M) / ROAD_CELL_DEG); ix++)
  for (let iy = Math.floor((Math.min(fa, ta) - M) / ROAD_CELL_DEG); iy <= Math.floor((Math.max(fa, ta) + M) / ROAD_CELL_DEG); iy++) keys.push(roadCellKey(ix, iy));
const cells: RoadCellData[] = [];
for (const key of keys) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
  if (res.ok) cells.push(decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()));
}
const net = roads.buildNetworkFromCells(cells, mode, { lng: (fl + tl) / 2, lat: (fa + ta) / 2 }, Infinity);
const pockets = roads.cutOffEdges(net);
const start = roads.snapToNetwork(net, from, 0);
console.log(`straight line: ${Math.round(distanceM([fl, fa], [tl, ta]))} m; start ${start && pockets[start.edge] ? "IN A POCKET" : "on the main network"}`);
for (const within of [60, 300]) {
  const path = start ? roads.findPath(net, start, to, within) : null;
  const len = path ? path.slice(1).reduce((s, p, i) => s + distanceM(path[i], p), 0) : 0;
  const end = path?.at(-1);
  console.log(`findPath (goal within ${within} m): ${path ? `${Math.round(len)} m by road, ends ${Math.round(distanceM(end!, [tl, ta]))} m from the target` : "NO PATH"}`);
}
const near = roads.snapToNetwork(net, to, 0);
const p = near ? roads.positionOf(net, near) : null;
console.log(`nearest road to the target: ${p ? Math.round(distanceM([p.lng, p.lat], [tl, ta])) : "?"} m away${near && pockets[near.edge] ? " (in a pocket)" : ""}`);
