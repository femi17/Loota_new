// The world beyond Nigeria (owner, 27 Oct 2026, in the United States: "I cannot pump my tire at the gas station… my
// bus icon is not lit up"): fills the squares around a spot from OpenStreetMap, as the game does when a hunter comes
// there, and checks petrol stations and bus stops are in, and none private; a square is filled once; Nigeria is left
// as it is. What it fills stays (it's the real data the game needs there). --refill first clears the 9 squares around
// (outside Nigeria only) and fills them again, after the rules change.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/fill-area-check.mts [lng lat] [--refill]
import { createClient } from "@supabase/supabase-js";
import { fillArea } from "@/lib/fill-area";
import { inNigeria } from "@/game/journey";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const args = process.argv.slice(2).filter((a) => a !== "--refill");
const refill = process.argv.includes("--refill");
const [lng, lat] = args.length >= 2 ? args.map(Number) : [-122.146, 37.44]; // Cowper St, Palo Alto
const AREA_DEG = 0.05;
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

const ix = Math.floor(lng / AREA_DEG);
const iy = Math.floor(lat / AREA_DEG);
const keys: string[] = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) keys.push(`${ix + dx}_${iy + dy}`);

if (refill && !inNigeria({ lng, lat })) {
  for (const key of keys) {
    const [kx, ky] = key.split("_").map(Number);
    const box = { w: kx * AREA_DEG, s: ky * AREA_DEG };
    for (const table of ["places", "transit_stops"]) {
      let q = admin.from(table).delete().gte("lng", box.w).lt("lng", box.w + AREA_DEG).gte("lat", box.s).lt("lat", box.s + AREA_DEG);
      if (table === "transit_stops") q = q.eq("kind", "bus"); // airports and stations stay
      const { error } = await q;
      if (error) throw error;
    }
    await admin.from("filled_areas").delete().eq("cell", key);
  }
  console.log("cleared the 9 squares around, to fill again");
}

for (let i = 0; i < 9; i++) {
  const t = Date.now();
  const key = await fillArea(admin, lng, lat);
  if (!key) break;
  const { data } = await admin.from("filled_areas").select("places, stops, failed_at").eq("cell", key).single();
  console.log(`square ${key}: ${data?.failed_at ? "FAILED" : `${data?.places} places, ${data?.stops} bus stops`} in ${Date.now() - t} ms`);
}
const { data: states } = await admin.from("filled_areas").select("cell, filled_at").in("cell", keys);
const done = (states ?? []).filter((s) => s.filled_at).length;
check("the 9 squares around are filled", done === 9, `${done} of 9`);
check("…and each only once (another call does nothing)", (await fillArea(admin, lng, lat)) === null);
const box = { lng0: lng - 0.03, lng1: lng + 0.03, lat0: lat - 0.03, lat1: lat + 0.03 };
const count = async (table: string, kind: string) =>
  (await admin.from(table).select("id", { count: "exact", head: true }).eq("kind", kind).gte("lng", box.lng0).lte("lng", box.lng1).gte("lat", box.lat0).lte("lat", box.lat1)).count ?? 0;
check("petrol stations within ~3 km", (await count("places", "fuel")) > 0, `${await count("places", "fuel")}`);
check("places to eat", (await count("places", "eat")) > 0, `${await count("places", "eat")}`);
check("bus stops", (await count("transit_stops", "bus")) > 0, `${await count("transit_stops", "bus")}`);
const { data: yard } = await admin.from("places").select("id").ilike("name", "%Corporation Yard%").gte("lng", box.lng0).lte("lng", box.lng1).gte("lat", box.lat0).lte("lat", box.lat1);
check("no private fuel yards", !yard?.length);
const { data: nearest } = await admin.rpc("places_near", { p_kinds: ["fuel"], p_lng: lng, p_lat: lat, p_limit: 1 });
console.log("nearest petrol station:", JSON.stringify(nearest));
check("Nigeria is left as it is (its own data)", (await fillArea(admin, 3.3787, 6.5186)) === null);
console.log(fails ? `${fails} FAILED` : "all passed");
