/**
 * Adds Nigeria's shopping malls as chill spots (owner, 27 Oct 2026: "to chill, it should be either restaurants or
 * eateries, malls"), to the places already imported (scripts/build-places.mts takes them in from now on too). From the
 * map's own tiles (OpenFreeMap: the malls the map draws), over the cities where malls are; OpenStreetMap's query
 * service was too busy to answer. Malls already there are skipped, so it can be run again.
 *
 *   node scripts/add-malls.mts
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const Z = 14;

/** The cities, each with how far out (km) its malls might be. */
const CITIES: [string, number, number, number][] = [
  ["Lagos", 3.38, 6.52, 30], ["Abuja", 7.45, 9.06, 22], ["Port Harcourt", 7.01, 4.82, 15], ["Ibadan", 3.9, 7.39, 15],
  ["Kano", 8.52, 12.0, 12], ["Benin City", 5.62, 6.34, 12], ["Enugu", 7.5, 6.45, 10], ["Kaduna", 7.44, 10.52, 10],
  ["Abeokuta", 3.35, 7.15, 8], ["Ilorin", 4.55, 8.5, 8], ["Owerri", 7.03, 5.48, 8], ["Uyo", 7.93, 5.04, 8],
  ["Calabar", 8.33, 4.96, 8], ["Warri", 5.75, 5.52, 8], ["Jos", 8.89, 9.9, 8], ["Asaba", 6.73, 6.2, 6], ["Onitsha", 6.79, 6.15, 6],
  ["Akure", 5.2, 7.25, 6], ["Osogbo", 4.55, 7.77, 6], ["Ado-Ekiti", 5.22, 7.62, 6], ["Maiduguri", 13.15, 11.83, 6],
  ["Sokoto", 5.24, 13.06, 6], ["Makurdi", 8.53, 7.73, 6], ["Minna", 6.55, 9.61, 6], ["Lokoja", 6.74, 7.8, 6], ["Yola", 12.46, 9.21, 6],
];

const template = ((await (await fetch("https://tiles.openfreemap.org/planet")).json()) as { tiles: string[] }).tiles[0];
const n = 2 ** Z;
const tx = (lng: number) => Math.floor(((lng + 180) / 360) * n);
const ty = (lat: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
const tiles = new Set<string>();
for (const [, lng, lat, km] of CITIES) {
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let x = tx(lng - dLng); x <= tx(lng + dLng); x++) for (let y = ty(lat + dLat); y <= ty(lat - dLat); y++) tiles.add(`${x}/${y}`);
}
console.log(`${tiles.size} map tiles over ${CITIES.length} cities`);

const malls = new Map<string, { kind: "rest"; name: string; lng: number; lat: number }>();
const list = [...tiles];
let done = 0;
async function worker() {
  for (;;) {
    const key = list.pop();
    if (!key) return;
    const [x, y] = key.split("/").map(Number);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(template.replace("{z}", String(Z)).replace("{x}", String(x)).replace("{y}", String(y)), { signal: AbortSignal.timeout(20_000) });
        if (res.status === 204 || res.status === 404) break;
        if (!res.ok) throw new Error(String(res.status));
        const poi = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer()))).layers.poi;
        for (let i = 0; i < (poi?.length ?? 0); i++) {
          const f = poi.feature(i);
          if (f.properties.subclass !== "mall") continue;
          const g = f.toGeoJSON(x, y, Z).geometry;
          if (g.type !== "Point") continue;
          const [lng, lat] = g.coordinates;
          const name = typeof f.properties.name === "string" && f.properties.name ? f.properties.name : "Shopping mall";
          malls.set(`${name}:${lng.toFixed(4)}:${lat.toFixed(4)}`, { kind: "rest", name, lng: +lng.toFixed(6), lat: +lat.toFixed(6) });
        }
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (++done % 200 === 0) console.log(`  ${done} of ${tiles.size} tiles`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

let added = 0;
for (const m of malls.values()) {
  const d = 0.0005; // ~50 m
  const { data: there } = await db.from("places").select("id").eq("kind", "rest").gte("lng", m.lng - d).lte("lng", m.lng + d).gte("lat", m.lat - d).lte("lat", m.lat + d).limit(1);
  if (there?.length) continue;
  const { error } = await db.from("places").insert(m);
  if (error) throw error;
  added++;
}
console.log(`${malls.size} malls on the map in Nigeria's cities; ${added} added as chill spots`);
