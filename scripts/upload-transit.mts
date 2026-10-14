/**
 * Loads the public transport data made by scripts/build-transit.mts into the
 * database (tables transit_lines and transit_stops), replacing what's there.
 * Trips already taken keep their names and paths, so they aren't affected.
 *
 *   node scripts/upload-transit.mts <transit.json>
 *
 * The full sequence: transit:build, transit:roadside, transit:airports (world airports), then this.
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

type Pt = [number, number];
type Built = {
  lines: { id: string; name: string; colour: string; path: Pt[]; length_m: number; stops: { name: string; lng: number; lat: number; along_m: number }[] }[];
  buses: { name: string; lng: number; lat: number; park: boolean }[];
  airports: { code: string; name: string; lng: number; lat: number; city?: string; country?: string }[];
};

process.loadEnvFile(".env.local");
const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/upload-transit.mts <transit.json>");
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, "utf8")) as Built;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

const check = <T,>(result: { error: { message: string } | null; data?: T }) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

// Stops first (they point at lines), then lines no longer in the data.
check(await db.from("transit_stops").delete().gte("id", 0));
check(await db.from("transit_lines").upsert(data.lines.map((l) => ({ id: l.id, name: l.name, colour: l.colour, path: l.path, length_m: l.length_m }))));
const ids = data.lines.map((l) => l.id);
check(await db.from("transit_lines").delete().not("id", "in", `(${ids.map((id) => `"${id}"`).join(",")})`));

// Every row has every column (a batch insert fills missing ones with null, not the default).
const none = { line_id: null, along_m: null, code: null, park: false, city: null, country: null };
const rows = [
  ...data.buses.map((b) => ({ ...none, kind: "bus", name: b.name, lng: b.lng, lat: b.lat, park: b.park })),
  ...data.lines.flatMap((l) => l.stops.map((s) => ({ ...none, kind: "train", name: s.name, lng: s.lng, lat: s.lat, line_id: l.id, along_m: s.along_m }))),
  ...data.airports.map((a) => ({ ...none, kind: "plane", name: a.name, lng: a.lng, lat: a.lat, code: a.code, city: a.city ?? null, country: a.country ?? null })),
];
for (let i = 0; i < rows.length; i += 500) check(await db.from("transit_stops").insert(rows.slice(i, i + 500)));
console.log(`Loaded ${data.lines.length} lines, ${data.buses.length} bus stops, ${rows.filter((r) => r.kind === "train").length} stations, ${data.airports.length} airports.`);
