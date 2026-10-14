/**
 * Uploads the main-road network made by scripts/build-highways.mts next to the
 * road squares (roads/<ROAD_DATA_VERSION>/highways.json.gz), replacing any earlier one.
 *
 *   node scripts/upload-highways.mts <highways.json.gz>
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ROAD_DATA_VERSION } from "../src/game/roadData.ts";

process.loadEnvFile(".env.local");
const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/upload-highways.mts <highways.json.gz>");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const { error } = await db.storage.from("roads").upload(`${ROAD_DATA_VERSION}/highways.json.gz`, readFileSync(file), {
  contentType: "application/gzip",
  cacheControl: "604800",
  upsert: true,
});
if (error) throw error;
console.log(`Uploaded ${ROAD_DATA_VERSION}/highways.json.gz.`);
