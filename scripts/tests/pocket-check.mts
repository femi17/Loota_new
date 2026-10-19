// Is a spot on a road cut off from the rest (a pocket)? And where's the nearest proper road?
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/pocket-check.mts <lng> <lat>
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData } from "@/game/roadData";
import * as roads from "@/game/roads";
import { distanceM } from "@/game/geo";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const [lng, lat] = process.argv.slice(2).map(Number);
const keys: string[] = [];
for (let ix = Math.floor((lng - 0.02) / ROAD_CELL_DEG); ix <= Math.floor((lng + 0.02) / ROAD_CELL_DEG); ix++)
  for (let iy = Math.floor((lat - 0.02) / ROAD_CELL_DEG); iy <= Math.floor((lat + 0.02) / ROAD_CELL_DEG); iy++) keys.push(roadCellKey(ix, iy));
const cells: RoadCellData[] = [];
for (const key of keys) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
  if (res.ok) cells.push(decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()));
}
const net = roads.buildNetworkFromCells(cells, (process.argv[4] ?? "walk") as never, { lng, lat });
const pockets = roads.cutOffEdges(net);
const at = roads.snapToNetwork(net, { lng, lat }, 0)!;
const p = roads.positionOf(net, at);
console.log(`nearest road: ${Math.round(distanceM([lng, lat], [p.lng, p.lat]))} m away, ${pockets[at.edge] ? "IN A CUT-OFF POCKET" : "on the main network"}`);
console.log(`pocket edges: ${pockets.reduce((n, x) => n + x, 0)} of ${net.edges.length}`);
if (pockets[at.edge]) {
  const main = roads.snapToNetwork(net, { lng, lat }, 0, pockets)!;
  const m = roads.positionOf(net, main);
  console.log(`nearest proper road: ${Math.round(distanceM([lng, lat], [m.lng, m.lat]))} m away at ${m.lng.toFixed(5)}, ${m.lat.toFixed(5)}`);
}
