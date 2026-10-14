/**
 * Loads the places made by scripts/build-places.mts (petrol stations,
 * hospitals, places to eat and rest, tyre shops, mechanics) into the
 * database, replacing what's there.
 *
 *   node scripts/upload-places.mts <places.json>
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/upload-places.mts <places.json>");
  process.exit(1);
}
const { places } = JSON.parse(readFileSync(file, "utf8")) as { places: { kind: string; name: string; lng: number; lat: number }[] };
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

const { error: clearError } = await db.from("places").delete().gte("id", 0);
if (clearError) throw clearError;
for (let i = 0; i < places.length; i += 500) {
  const { error } = await db.from("places").insert(places.slice(i, i + 500));
  if (error) throw error;
}
const counts: Record<string, number> = {};
for (const p of places) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
console.log(`Loaded ${places.length} places:`, counts);
