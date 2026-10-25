import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData, type RoadCellFile } from "@/game/roadData";

/** Our road squares, fetched once per server process. */
const cells = new Map<string, Promise<RoadCellData | null>>();
export function roadCell(key: string) {
  let c = cells.get(key);
  if (!c) {
    c = (async () => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
      if (!res.ok || !res.body) return null;
      return decodeRoadCell((await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).json()) as RoadCellFile);
    })().catch(() => null);
    cells.set(key, c);
  }
  return c;
}

/** The road squares covering `halfM` metres around a spot. */
export function roadCellsAround(lng: number, lat: number, halfM: number) {
  const dLng = halfM / (111320 * Math.cos((lat * Math.PI) / 180)), dLat = halfM / 110574;
  const keys: string[] = [];
  for (let ix = Math.floor((lng - dLng) / ROAD_CELL_DEG); ix <= Math.floor((lng + dLng) / ROAD_CELL_DEG); ix++) {
    for (let iy = Math.floor((lat - dLat) / ROAD_CELL_DEG); iy <= Math.floor((lat + dLat) / ROAD_CELL_DEG); iy++) keys.push(roadCellKey(ix, iy));
  }
  return Promise.all(keys.map(roadCell));
}

/** Main roads (busy, wide): a spot meant to be found in the streets keeps off these. */
export const MAIN_ROADS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const NOT_ROADS = new Set(["footway", "path", "steps", "cycleway", "bridleway", "pedestrian"]);

const metres = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) =>
  Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);

/**
 * A point on a side street (not a main road, not a footpath) between `minM` and `maxM` from a spot, at random, and
 * at least `awayFromMainM` from any main road; null if there's none in our road data.
 */
export async function sideStreetSpot(lng: number, lat: number, minM: number, maxM: number, awayFromMainM = 0) {
  const found = await roadCellsAround(lng, lat, maxM + awayFromMainM + 50);
  const side: { lng: number; lat: number }[] = [];
  const main: { lng: number; lat: number }[] = [];
  for (const c of found) {
    if (!c) continue;
    const at = new Map(c.points.map((p) => [p.id, p]));
    for (const w of c.ways) {
      if (NOT_ROADS.has(w.cls)) continue;
      const list = MAIN_ROADS.has(w.cls) ? main : side;
      for (const id of w.points) {
        const p = at.get(id);
        if (p) list.push({ lng: p.lng, lat: p.lat });
      }
    }
  }
  const from = { lng, lat };
  const ok = side.filter((p) => {
    const d = metres(from, p);
    return d >= minM && d <= maxM && !main.some((m) => metres(m, p) < awayFromMainM);
  });
  return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
}
