// Which petrol stations (and other places) sit down their own driveway or side street, off a main road? For each one:
// the nearest road of any kind, and the nearest road that isn't a service road or driveway. The game counts you at a
// place within (nearest road + 20 m), at most 60 m (owner, 3 Nov 2026: "the user should go down the road").
//   node scripts/tests/place-driveways-check.mts [lng lat] [kind]
import { createRequire } from "node:module";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData, type RoadCellFile } from "../../src/game/roadData.ts";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [lng0, lat0] = [Number(process.argv[2] ?? 3.38), Number(process.argv[3] ?? 6.52)];
const kind = process.argv[4] ?? "fuel";

const cells = new Map<string, RoadCellData | null>();
async function cell(key: string) {
  if (!cells.has(key)) {
    const res = await fetch(`${url}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}/${key}.json.gz`);
    if (!res.ok || !res.body) cells.set(key, null);
    else cells.set(key, decodeRoadCell((await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).json()) as RoadCellFile));
  }
  return cells.get(key)!;
}

/** The nearest point on a road (any kind) and on a through road (not service), with where it is. */
async function nearest(lng: number, lat: number) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  const ix = Math.floor(lng / ROAD_CELL_DEG), iy = Math.floor(lat / ROAD_CELL_DEG);
  const best = { any: { m: Infinity, lng: 0, lat: 0, cls: "" }, through: { m: Infinity, lng: 0, lat: 0, cls: "" } };
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const c = await cell(roadCellKey(ix + dx, iy + dy));
    if (!c) continue;
    const at = new Map(c.points.map((p) => [p.id, p]));
    for (const w of c.ways) {
      if (["footway", "path", "steps", "pedestrian", "cycleway", "bridleway", "motorway", "motorway_link"].includes(w.cls)) continue;
      for (let i = 1; i < w.points.length; i++) {
        const a = at.get(w.points[i - 1]), b = at.get(w.points[i]);
        if (!a || !b) continue;
        const ax = (a.lng - lng) * kx, ay = (a.lat - lat) * ky, bx = (b.lng - lng) * kx, by = (b.lat - lat) * ky;
        const vx = bx - ax, vy = by - ay, len = vx * vx + vy * vy;
        const t = len ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len)) : 0;
        const m = Math.hypot(ax + t * vx, ay + t * vy);
        const p = { m, lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t, cls: w.cls };
        if (m < best.any.m) best.any = p;
        if (w.cls !== "service" && m < best.through.m) best.through = p;
      }
    }
  }
  return best;
}

const { data } = await admin.from("places").select("id, name, lng, lat").eq("kind", kind)
  .gte("lng", lng0 - 0.03).lte("lng", lng0 + 0.03).gte("lat", lat0 - 0.03).lte("lat", lat0 + 0.03).limit(60);
for (const p of (data ?? []) as { id: number; name: string; lng: number; lat: number }[]) {
  const n = await nearest(p.lng, p.lat);
  const reach = Math.min(60, Math.max(20, n.any.m + 20));
  const fromMain = n.through.m > reach ? "must come down the driveway" : "reached from the road";
  console.log(`${p.id}\t${p.name.slice(0, 28).padEnd(28)}\tnearest ${n.any.cls} ${Math.round(n.any.m)} m\tthrough road ${n.through.cls} ${Math.round(n.through.m)} m\treach ${Math.round(reach)} m\t${fromMain}` +
    (n.through.m > reach ? `\tdriveway ${n.any.lng.toFixed(6)},${n.any.lat.toFixed(6)}\tmain ${n.through.lng.toFixed(6)},${n.through.lat.toFixed(6)}` : ""));
}
