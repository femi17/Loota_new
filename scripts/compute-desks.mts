// Where each Nigerian railway station's ticket office and airport's check-in desk stands (owner, 19 Oct 2026: the
// server insists you buy there): the road nearest the stop (within 250 m of a station, 1.9 km of an airport) that a
// hunter can reach (never a cut-off pocket such as an airfield's own roads), from our own road data. Stored in
// transit_stops.desk_lng/desk_lat; the game draws the hall there and start_trip checks the player is at it.
// Run again after a road data rebuild.
//   node --import ./scripts/tests/ts-ext.mjs scripts/compute-desks.mts [--dry]
import { createRequire } from "node:module";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData } from "@/game/roadData";
import * as roads from "@/game/roads";
import { distanceM } from "@/game/geo";
const app = createRequire(new URL("../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const dry = process.argv.includes("--dry");

const cache = new Map<string, RoadCellData | null>();
async function cell(key: string) {
  if (!cache.has(key)) {
    const res = await fetch(`${url}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
    cache.set(key, res.ok ? decodeRoadCell(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json()) : null);
  }
  return cache.get(key) ?? null;
}

const { data: stops, error } = await admin
  .from("transit_stops")
  .select("id, kind, name, lng, lat")
  .in("kind", ["train", "plane"])
  .gte("lng", 2.6)
  .lte("lng", 14.7)
  .gte("lat", 4.2)
  .lte("lat", 13.9);
if (error) throw error;

let set = 0;
const none: string[] = [];
for (const st of stops as { id: number; kind: "train" | "plane"; name: string; lng: number; lat: number }[]) {
  // (A station whose nearest reachable road is beyond the old 150 m reach gets its desk there: the desk rule replaces
  // the reach, so the station becomes usable at all.)
  const withinM = st.kind === "plane" ? 1900 : 250;
  // The roads around the stop: wide enough that the network beyond the airfield is whole (its pockets show as such).
  const reachM = withinM + 1500;
  const dLng = reachM / (111320 * Math.cos((st.lat * Math.PI) / 180));
  const dLat = reachM / 110574;
  const cells: RoadCellData[] = [];
  for (let ix = Math.floor((st.lng - dLng) / ROAD_CELL_DEG); ix <= Math.floor((st.lng + dLng) / ROAD_CELL_DEG); ix++)
    for (let iy = Math.floor((st.lat - dLat) / ROAD_CELL_DEG); iy <= Math.floor((st.lat + dLat) / ROAD_CELL_DEG); iy++) {
      const c = await cell(roadCellKey(ix, iy));
      if (c) cells.push(c);
    }
  if (!cells.length) {
    none.push(`${st.kind} ${st.name}: no road data`);
    continue;
  }
  const net = roads.buildNetworkFromCells(cells, "walk", st, reachM);
  const rp = roads.snapToNetwork(net, st, 0, roads.cutOffEdges(net));
  const p = rp ? roads.positionOf(net, rp) : null;
  const m = p ? distanceM([st.lng, st.lat], [p.lng, p.lat]) : Infinity;
  if (!p || m > withinM) {
    none.push(`${st.kind} ${st.name}: nearest reachable road ${Number.isFinite(m) ? `${Math.round(m)} m` : "none"}`);
    continue;
  }
  const desk = { desk_lng: Math.round(p.lng * 1e7) / 1e7, desk_lat: Math.round(p.lat * 1e7) / 1e7 };
  if (!dry) {
    const { error: e } = await admin.from("transit_stops").update(desk).eq("id", st.id);
    if (e) throw e;
  }
  set++;
  console.log(`${st.kind === "plane" ? "✈" : "🚆"} ${st.name}: desk ${Math.round(m)} m from its point`);
}
console.log(`${dry ? "(dry run) " : ""}desks: ${set} of ${stops.length}`);
for (const n of none) console.log(`   no desk: ${n}`);
