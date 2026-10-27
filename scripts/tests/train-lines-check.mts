// Train lines abroad (owner, 27 Oct 2026: "the bus, train should work according to the country not showing nigeria
// again"): brings in the train lines through the squares around a spot from OpenStreetMap, as filling them does, and
// checks the line through it is in, with its stations in order along it and a fare-worthy distance between them. What
// it brings in stays (real data the game needs there).
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/train-lines-check.mts [lng lat]
import { createClient } from "@supabase/supabase-js";
import { fillTrainLinesAround } from "@/lib/fill-area";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const [lng, lat] = args.length >= 2 ? args.map(Number) : [-122.146, 37.44]; // Cowper St, Palo Alto
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

const t = Date.now();
const added = await fillTrainLinesAround(admin, lng, lat);
console.log(`${added} stations brought in, ${Math.round((Date.now() - t) / 1000)} s`);
const { data: near } = await admin.rpc("stops_near", { p_kind: "train", p_lng: lng, p_lat: lat, p_limit: 6 });
const stations = (near ?? []) as { id: number; name: string; metres: number; line_id: string; line: string }[];
for (const s of stations) console.log(`  ${s.name} · ${s.line} (${s.line_id}) · ${s.metres} m`);
check("a train station near (within 10 km)", stations.length > 0 && stations[0].metres < 10_000, stations[0] ? `${stations[0].name}, ${stations[0].metres} m` : "none");
const lineId = stations[0]?.line_id;
if (lineId) {
  const { data: line } = await admin.from("transit_lines").select("name, length_m, path").eq("id", lineId).single();
  const { data: stops } = await admin.from("transit_stops").select("name, along_m").eq("line_id", lineId).order("along_m");
  console.log(`line ${line?.name}: ${Math.round((line?.length_m ?? 0) / 1000)} km, ${(line?.path as unknown[])?.length} points, ${stops?.length} stations:`);
  console.log("  " + (stops ?? []).map((s) => `${s.name} ${(s.along_m / 1000).toFixed(1)}`).join(" · "));
  check("its line has a way and several stations", (line?.length_m ?? 0) > 5000 && (stops?.length ?? 0) >= 3);
  check("…the stations spread along it (not all at one point)", new Set((stops ?? []).map((s) => Math.round(s.along_m / 500))).size >= 3);
  check("…named (not 'Stop N')", (stops ?? []).filter((s) => /^Stop \d+$/.test(s.name)).length <= (stops?.length ?? 0) / 4);
}
check("no Nigerian station offered here", !stations.some((s) => s.metres > 100_000));
console.log(fails ? `${fails} FAILED` : "all passed");
