import { ROAD_CELL_DEG, ROAD_DATA_VERSION, ROAD_FLAGS, decodeRoadCell, roadCellKey, type RoadCellData, type RoadCellFile } from "@/game/roadData";

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

/** Whether we have road data around a point (outside it, only the routing service knows the roads). */
export async function haveRoadData(lng: number, lat: number) {
  return (await roadCellsAround(lng, lat, 100)).some(Boolean);
}

/** Main roads (busy, wide): a spot meant to be found in the streets keeps clear of these. */
export const MAIN_ROADS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
/** Ordinary streets: where finds, detours and the Masquerade's traps lie (owner, 25 Oct 2026: "inside the streets"). */
const STREETS = new Set(["residential", "living_street", "unclassified", "tertiary"]);

type XY = { x: number; y: number };

/**
 * Spots on ordinary streets (at ground level, every ~20 m along them) within `maxM` of a point, each at least
 * `clearM` from any main road, with their distance from the point.
 */
async function streetSpots(lng: number, lat: number, maxM: number, clearM: number) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  const local = (p: { lng: number; lat: number }): XY => ({ x: (p.lng - lng) * kx, y: (p.lat - lat) * ky });
  const main: [XY, XY][] = [];
  const candidates: XY[] = [];
  for (const c of await roadCellsAround(lng, lat, maxM + clearM + 100)) {
    if (!c) continue;
    const at = new Map(c.points.map((p) => [p.id, p]));
    for (const w of c.ways) {
      const isMain = MAIN_ROADS.has(w.cls);
      if (!isMain && (!STREETS.has(w.cls) || w.flags & (ROAD_FLAGS.bridge | ROAD_FLAGS.tunnel | ROAD_FLAGS.private))) continue;
      for (let k = 1; k < w.points.length; k++) {
        const p = at.get(w.points[k - 1]), q = at.get(w.points[k]);
        if (!p || !q) continue;
        const a = local(p), b = local(q);
        if (isMain) {
          main.push([a, b]);
          continue;
        }
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = 0; t <= len; t += 20) {
          const f = len ? t / len : 0;
          const s = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
          if (Math.hypot(s.x, s.y) <= maxM) candidates.push(s);
        }
      }
    }
  }
  const clear = (s: XY) =>
    main.every(([a, b]) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const f = Math.max(0, Math.min(1, ((s.x - a.x) * dx + (s.y - a.y) * dy) / (dx * dx + dy * dy || 1e-9)));
      return Math.hypot(a.x + dx * f - s.x, a.y + dy * f - s.y) >= clearM;
    });
  return candidates.filter(clear).map((s) => ({ lng: lng + s.x / kx, lat: lat + s.y / ky, metres: Math.hypot(s.x, s.y) }));
}

/** A spot on an ordinary street between `minM` and `maxM` from a point, at random, clear of main roads; null if none. */
export async function sideStreetSpot(lng: number, lat: number, minM: number, maxM: number, clearM = 35) {
  const ok = (await streetSpots(lng, lat, maxM, clearM)).filter((s) => s.metres >= minM);
  return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
}

/** The nearest spot on an ordinary street within `maxM` of a point, clear of main roads; null if none. */
export async function nearestSideStreet(lng: number, lat: number, maxM: number, clearM = 35) {
  const all = await streetSpots(lng, lat, maxM, clearM);
  return all.length ? all.reduce((best, s) => (s.metres < best.metres ? s : best)) : null;
}
