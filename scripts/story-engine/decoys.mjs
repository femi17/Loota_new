// Put a story hunt's decoys on the map from the map lookups already made (docs/stories/.map-cache.json), for a hunt
// imported before decoys were kept (owner, 1 Nov 2026: stopping at a near miss springs a deep trap).
// Each decoy found on the map and far enough from its key's place (its exact reach + 100 m + the trap's 100 m).
//   node scripts/story-engine/decoys.mjs <hunt id>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const hunt = process.argv[2];
if (!hunt) throw new Error("Usage: node scripts/story-engine/decoys.mjs <hunt id>");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const cache = JSON.parse(readFileSync(new URL("../../docs/stories/.map-cache.json", import.meta.url), "utf8"));
const metres = (a, b) => {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.round(Math.hypot(x, y) * 6371000);
};
const { data: h } = await db.from("hunts").select("story").eq("id", hunt).single();
const { data: keys } = await db.from("hunt_keys").select("n, area_lng, area_lat, exact_m").eq("hunt_id", hunt).order("n");
const rows = [], skipped = [];
for (const k of keys) {
  for (const d of h.story.decoys?.[k.n] ?? []) {
    const at = cache[d.searchName];
    if (!at) { skipped.push(`key ${k.n}: ${d.place} (not on the map)`); continue; }
    const gap = metres({ lng: k.area_lng, lat: k.area_lat }, at);
    if (gap < (k.exact_m ?? 120) + 200) { skipped.push(`key ${k.n}: ${d.place} (only ${gap} m from the key)`); continue; }
    rows.push({ hunt_id: hunt, key_n: k.n, place: d.place, lng: at.lng, lat: at.lat });
  }
}
await db.from("hunt_decoys").delete().eq("hunt_id", hunt);
const { error } = await db.from("hunt_decoys").insert(rows);
if (error) throw error;
console.log(`${rows.length} decoys on the map; ${keys.map((k) => `key ${k.n}: ${rows.filter((r) => r.key_n === k.n).length}`).join(", ")}`);
if (skipped.length) console.log(`skipped:\n  ${skipped.join("\n  ")}`);
