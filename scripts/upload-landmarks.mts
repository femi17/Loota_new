/**
 * Loads the landmarks in scripts/data/landmarks.json (name, place, check-in
 * area, tier, a fact, and multiple-choice questions) into the database,
 * updating any with the same name. Edit the JSON and run this again to change
 * or add landmarks.
 *
 *   node scripts/upload-landmarks.mts [landmarks.json]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

type Landmark = {
  name: string;
  city: string;
  lng: number;
  lat: number;
  radius: number;
  tier: 1 | 2 | 3;
  fact: string;
  questions: { q: string; options: string[]; answer: number }[];
};

process.loadEnvFile(".env.local");
const file = process.argv[2] ?? "scripts/data/landmarks.json";
const list = JSON.parse(readFileSync(file, "utf8")) as Landmark[];
for (const l of list) {
  for (const q of l.questions) {
    if (q.options.length < 2 || q.answer < 0 || q.answer >= q.options.length) throw new Error(`${l.name}: bad question "${q.q}"`);
  }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const rows = list.map((l) => ({ name: l.name, city: l.city, lng: l.lng, lat: l.lat, radius_m: l.radius, tier: l.tier, fact: l.fact, questions: l.questions }));
const { error } = await db.from("landmarks").upsert(rows, { onConflict: "name" });
if (error) throw error;
console.log(`Loaded ${rows.length} landmarks with ${list.reduce((n, l) => n + l.questions.length, 0)} questions.`);
