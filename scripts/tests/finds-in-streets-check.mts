// Finds, relics, Detours and trap chests inside the streets (owner, 25 Oct 2026: "Items to find, relics, quiz location
// should not be on the main road, it should be inside the streets"), on our own road data: a find in the squares on
// four main roads in Lagos lands on a side street at least 35 m from any main road; 40 places' Detour spots are within
// 200 m of the place and 30 m clear of main roads; a trap chest's spot is 180–280 m from its key, in the streets.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/finds-in-streets-check.mts
import { createClient } from "@supabase/supabase-js";
import { CELL_DEG } from "@/game/items";
import { MAIN_ROADS, roadCellsAround, sideStreetSpot } from "@/lib/road-cells";
import { findSpot } from "@/lib/world-spawn";
import { stockCruise } from "@/lib/cruise-drops";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};
const metres = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) =>
  Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);

/** How far a spot is from the nearest main road. */
async function clearOfMain(spot: { lng: number; lat: number }) {
  let clear = Infinity;
  const kx = 111320 * Math.cos((spot.lat * Math.PI) / 180), ky = 110574;
  for (const cell of await roadCellsAround(spot.lng, spot.lat, 400)) {
    if (!cell) continue;
    const pts = new Map(cell.points.map((p) => [p.id, p]));
    for (const way of cell.ways) {
      if (!MAIN_ROADS.has(way.cls)) continue;
      for (let i = 1; i < way.points.length; i++) {
        const a = pts.get(way.points[i - 1]), b = pts.get(way.points[i]);
        if (!a || !b) continue;
        const ax = (a.lng - spot.lng) * kx, ay = (a.lat - spot.lat) * ky, bx = (b.lng - spot.lng) * kx, by = (b.lat - spot.lat) * ky;
        const dx = bx - ax, dy = by - ay;
        const f = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-9)));
        clear = Math.min(clear, Math.hypot(ax + dx * f, ay + dy * f));
      }
    }
  }
  return clear;
}

// ---- Finds in the squares on main roads
for (const [label, at] of [
  ["Apapa-Oworonshoki Expressway", { lng: 3.392, lat: 6.556 }],
  ["Ikorodu Road, Fadeyi", { lng: 3.372, lat: 6.528 }],
  ["Third Mainland Bridge, Oworonshoki", { lng: 3.401, lat: 6.551 }],
  ["Herbert Macaulay Way, Yaba", { lng: 3.379, lat: 6.507 }],
] as const) {
  const x = Math.floor(at.lng / CELL_DEG), y = Math.floor(at.lat / CELL_DEG);
  const clears: number[] = [];
  let none = 0;
  for (let i = 0; i < 5; i++) {
    const s = await findSpot(x, y);
    if (!s) none++;
    else clears.push(await clearOfMain({ lng: s[0], lat: s[1] }));
  }
  check(`finds in the square on ${label}: in the streets`, clears.length > 0 && clears.every((c) => c >= 35), `${clears.map((c) => Math.round(c)).join(", ")} m from a main road${none ? `; ${none} empty` : ""}`);
}

// ---- Detour spots of places
const { data: places } = await admin.from("places").select("name, lng, lat, street_lng, street_lat").not("street_lng", "is", null).gte("lng", 3.3).lte("lng", 3.45).gte("lat", 6.43).lte("lat", 6.6).limit(40);
let bad = 0;
const worst: string[] = [];
for (const p of places ?? []) {
  const s = { lng: p.street_lng!, lat: p.street_lat! };
  const away = metres(p, s), clear = await clearOfMain(s);
  if (away > 200 || clear < 30) {
    bad++;
    worst.push(`${p.name}: ${Math.round(away)} m off, ${Math.round(clear)} m from a main road`);
  }
}
check(`${places?.length ?? 0} places' Detour spots: near the place, off the main roads`, (places?.length ?? 0) >= 20 && bad === 0, worst.slice(0, 3).join(" / "));

// ---- A trap chest's spot
const key = { lng: 3.378214, lat: 6.500147 };
const trap = await sideStreetSpot(key.lng, key.lat, 180, 280);
check("a trap chest 180–280 m from its key, in the streets", !!trap && metres(key, trap) >= 180 && metres(key, trap) <= 280 && (await clearOfMain(trap)) >= 35,
  trap ? `${Math.round(metres(key, trap))} m away, ${Math.round(await clearOfMain(trap))} m from a main road` : "none");

// ---- Cruise tokens (owner, 25–26 Oct 2026: rarer): a square on Herbert Macaulay Way rolled once: one token in a
// side street off the main roads (40% of the time) or nothing; then not rolled again while that lasts
const sq = { lng: 3.379, lat: 6.507 };
const cellKey = `${Math.floor(sq.lng / CELL_DEG)}:${Math.floor(sq.lat / CELL_DEG)}`;
const { data: before } = await admin.from("cruise_drops").select("id").eq("cell", cellKey);
const beforeIds = new Set((before ?? []).map((d) => d.id));
await admin.from("cruise_drops").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("cell", cellKey).gt("expires_at", new Date().toISOString());
const rolls: number[] = [];
let offMain = true;
for (let i = 0; i < 6; i++) {
  const added = await stockCruise(admin, sq.lng, sq.lat);
  rolls.push(added);
  const { data: fresh } = await admin.from("cruise_drops").select("id, lng, lat, taken_at").eq("cell", cellKey).gt("expires_at", new Date().toISOString());
  const again = await stockCruise(admin, sq.lng, sq.lat);
  if (again !== 0 || (fresh ?? []).length !== 1) offMain = false;
  for (const d of fresh ?? []) if (!d.taken_at && (await clearOfMain(d)) < 35) offMain = false;
  await admin.from("cruise_drops").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("cell", cellKey).gt("expires_at", new Date().toISOString());
}
check("cruise tokens: one roll per square, a token (off the main roads) or nothing, never two", offMain && rolls.every((r) => r === 0 || r === 1), rolls.join(","));
const { data: mine } = await admin.from("cruise_drops").select("id").eq("cell", cellKey);
const added = (mine ?? []).map((d) => d.id).filter((x) => !beforeIds.has(x));
if (added.length) await admin.from("cruise_drops").delete().in("id", added);

console.log(fails ? `${fails} FAILED` : "all passed");
