// Find the street spots (for Detours: on an ordinary street within 200 m, clear of main roads) of every unchecked place
// in a box; the game does this lazily as players come near (src/lib/place-streets.ts), this does an area at once.
//   node --import ./scripts/tests/ts-ext.mjs scripts/backfill-place-streets.mts [west south east north]   (default: Lagos)
import { createClient } from "@supabase/supabase-js";
import { fillPlaceStreets } from "@/lib/place-streets";
process.loadEnvFile(new URL("../.env.local", import.meta.url));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const [w, s, e, n] = process.argv.length >= 6 ? process.argv.slice(2, 6).map(Number) : [3.1, 6.38, 3.7, 6.72];
let total = 0;
// Step across the box in squares of about 4 km.
for (let lng = w + 0.02; lng < e + 0.02; lng += 0.04) {
  for (let lat = s + 0.02; lat < n + 0.02; lat += 0.04) {
    for (;;) {
      const done = await fillPlaceStreets(admin, lng, lat, 50, 0.02);
      total += done;
      if (done < 50) break;
    }
  }
  console.log(`…${lng.toFixed(2)}: ${total} places checked`);
}
const { count } = await admin.from("places").select("id", { count: "exact", head: true }).not("street_lng", "is", null);
console.log(`${total} places checked; ${count} places now have a street spot`);
