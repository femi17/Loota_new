// Can a hunter reach every key's chest? (owner, 20 Oct 2026: "I am in the 2nd key location. I cannot find the chest")
// Hunters move along roads and paths only; the chest rises within 60 m of a key's spot. For each key of the live and
// coming hunts: the nearest road or path to its spot, on foot and by vehicle.   node scripts/tests/key-spots-reachable.mts
import { createRequire } from "node:module";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData, type RoadCellFile } from "../../src/game/roadData.ts";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const CHEST_M = 60;
const FOOT_ONLY = new Set(["pedestrian", "footway", "path", "steps", "cycleway", "bridleway"]);

const cells = new Map<string, RoadCellData | null>();
async function cell(key: string) {
  if (!cells.has(key)) {
    const res = await fetch(`${url}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
    if (!res.ok || !res.body) cells.set(key, null);
    else cells.set(key, decodeRoadCell((await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).json()) as RoadCellFile));
  }
  return cells.get(key)!;
}

/** The nearest road segment to a point (metres), for walkers (every road but motorways) and for vehicles. */
async function nearest(lng: number, lat: number) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  const ix = Math.floor(lng / ROAD_CELL_DEG), iy = Math.floor(lat / ROAD_CELL_DEG);
  let walk = Infinity, drive = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const c = await cell(roadCellKey(ix + dx, iy + dy));
    if (!c) continue;
    const at = new Map(c.points.map((p) => [p.id, p]));
    for (const w of c.ways) {
      for (let i = 1; i < w.points.length; i++) {
        const a = at.get(w.points[i - 1]), b = at.get(w.points[i]);
        if (!a || !b) continue;
        const ax = (a.lng - lng) * kx, ay = (a.lat - lat) * ky, bx = (b.lng - lng) * kx, by = (b.lat - lat) * ky;
        const vx = bx - ax, vy = by - ay, len = vx * vx + vy * vy;
        const t = len ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len)) : 0;
        const d = Math.hypot(ax + t * vx, ay + t * vy);
        if (!w.cls.startsWith("motorway")) walk = Math.min(walk, d);
        if (!FOOT_ONLY.has(w.cls) && !(w.flags & 16)) drive = Math.min(drive, d);
      }
    }
  }
  return { walk: Math.round(walk), drive: Math.round(drive) };
}

const { data: hunts } = await admin.from("hunts").select("id, title, ends_at").eq("published", true).gt("ends_at", new Date().toISOString());
let bad = 0;
for (const h of hunts ?? []) {
  const { data: keys } = await admin.from("hunt_keys").select("n, spot_lng, spot_lat").eq("hunt_id", h.id).order("n");
  for (const k of keys ?? []) {
    const r = await nearest(k.spot_lng, k.spot_lat);
    const ok = r.walk <= CHEST_M * 0.75; // some room: the hunter stands on the road's line
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "FAR "} ${h.title} · key ${k.n}: nearest road/path ${r.walk} m (vehicles ${r.drive} m)`);
  }
}
console.log(bad ? `${bad} key(s) can't be reached` : "every chest can be reached");
