/**
 * Loads the Djinn's places (scripts/data/djinn-sites.json: name, country, place,
 * three traits and a cryptic verse) into the database, updating any with the
 * same name. Each place is moved onto the nearest path or road (OpenStreetMap's
 * routing service) so a hunter can stand on it; one with no road within 400 m
 * is left where it is, with a warning. Every place must be within taxi reach
 * (about 35 km) of an airport: check with the airports in the database.
 *
 *   node scripts/upload-djinn-sites.mts [djinn-sites.json]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

type Site = { name: string; country: string; lng: number; lat: number; continent: string; setting: string; kind: string; verse: string };

async function onRoad(lng: number, lat: number): Promise<[number, number] | null> {
  try {
    const res = await fetch(`https://routing.openstreetmap.de/routed-foot/nearest/v1/driving/${lng},${lat}?number=1`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const w = ((await res.json()) as { waypoints?: { location: [number, number]; distance: number }[] }).waypoints?.[0];
    return w && w.distance < 400 ? w.location : null;
  } catch {
    return null;
  }
}

process.loadEnvFile(".env.local");
const file = process.argv[2] ?? "scripts/data/djinn-sites.json";
const list = JSON.parse(readFileSync(file, "utf8")) as Site[];
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const rows = [];
for (const s of list) {
  const spot = await onRoad(s.lng, s.lat);
  if (!spot) console.warn(`  ${s.name}: no path or road within 400 m; left as given`);
  rows.push({ name: s.name, country: s.country, lng: spot?.[0] ?? s.lng, lat: spot?.[1] ?? s.lat, continent: s.continent, setting: s.setting, kind: s.kind, verse: s.verse });
  await new Promise((r) => setTimeout(r, 300)); // gentle on the free service
}
const { error } = await db.from("djinn_sites").upsert(rows, { onConflict: "name" });
if (error) throw error;
console.log(`Loaded ${rows.length} Djinn places.`);
for (const r of rows) {
  const { data } = await db.rpc("stops_near", { p_kind: "plane", p_lng: r.lng, p_lat: r.lat, p_limit: 1 });
  const airport = (data as { code: string; metres: number }[] | null)?.[0];
  if (!airport || airport.metres > 35_000) console.warn(`  ${r.name}: ${airport ? `${Math.round(airport.metres / 1000)} km from ${airport.code}` : "no airport"}: too far for a taxi`);
}
