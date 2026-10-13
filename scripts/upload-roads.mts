/**
 * Uploads road squares made by scripts/build-roads.mts to the public "roads"
 * storage bucket, under the version folder the game reads (ROAD_DATA_VERSION
 * in src/game/roadData.ts).
 *
 *   node scripts/upload-roads.mts <dir> [west,south,east,north]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 * Squares already uploaded are skipped, so it can be stopped and run again.
 * The optional box uploads only the squares inside it (e.g. a city first).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION } from "../src/game/roadData.ts";

process.loadEnvFile(".env.local");
const [dir, boxArg] = process.argv.slice(2);
if (!dir) {
  console.error("Usage: node scripts/upload-roads.mts <dir> [west,south,east,north]");
  process.exit(1);
}
const box = boxArg ? boxArg.split(",").map(Number) : null;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const BUCKET = "roads";

// A public bucket: anyone can read road data (it's OpenStreetMap's, already public); only this script writes.
const { error: bucketError } = await db.storage.createBucket(BUCKET, { public: true });
if (bucketError && !/already exists/i.test(bucketError.message)) throw bucketError;

const inBox = (key: string) => {
  if (!box) return true;
  const [ix, iy] = key.split("_").map(Number);
  return (ix + 1) * ROAD_CELL_DEG > box[0] && iy * ROAD_CELL_DEG < box[3] && ix * ROAD_CELL_DEG < box[2] && (iy + 1) * ROAD_CELL_DEG > box[1];
};
const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz") && inBox(f.replace(".json.gz", "")));

// What's already there (listing is paged).
const done = new Set<string>();
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await db.storage.from(BUCKET).list(ROAD_DATA_VERSION, { limit: 1000, offset });
  if (error) throw error;
  data.forEach((o) => done.add(o.name));
  if (data.length < 1000) break;
}
const todo = files.filter((f) => !done.has(f));
console.log(`${files.length} squares to host, ${files.length - todo.length} already uploaded, ${todo.length} to go`);

let uploaded = 0;
let failed = 0;
const started = Date.now();
async function worker() {
  for (let f = todo.pop(); f; f = todo.pop()) {
    for (let attempt = 1; ; attempt++) {
      const { error } = await db.storage.from(BUCKET).upload(`${ROAD_DATA_VERSION}/${f}`, readFileSync(join(dir, f)), {
        contentType: "application/gzip",
        cacheControl: "604800", // a week: a new build goes in a new version folder
        upsert: true,
      });
      if (!error) {
        uploaded++;
        break;
      }
      if (attempt === 4) {
        failed++;
        console.error(`${f}: ${error.message}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    if ((uploaded + failed) % 500 === 0) console.log(`${uploaded} uploaded, ${failed} failed (${Math.round((Date.now() - started) / 1000)} s)`);
  }
}
await Promise.all(Array.from({ length: 16 }, worker));
const manifest = readFileSync(join(dir, "manifest.json"));
await db.storage.from(BUCKET).upload(`${ROAD_DATA_VERSION}/manifest.json`, manifest, { contentType: "application/json", upsert: true });
console.log(`finished: ${uploaded} uploaded, ${failed} failed (${Math.round((Date.now() - started) / 1000)} s)`);
