import type { SupabaseClient } from "@supabase/supabase-js";
import { CELL_DEG } from "@/game/items";
import { sideStreetSpot } from "@/lib/road-cells";

/** How long a token lies in the street before it's gone. */
const LIFETIME_HOURS = 3;

/** The chance a square gets a token when it's due (owner, 26 Oct 2026: "too much… it should not be easy to find"). */
const CHANCE = 0.4;

/**
 * Cruise tokens in the streets (owner, 25–26 Oct 2026): now and then one lies on a side street of the square around a
 * player (the same squares as finds, ~550 m), off the main roads, seen only within 150 m. A square is rolled once per
 * token lifetime: a token (40%) or nothing (an empty marker, already taken, so it isn't rolled again till it lapses).
 */
export async function stockCruise(admin: SupabaseClient, lng: number, lat: number): Promise<number> {
  const x = Math.floor(lng / CELL_DEG), y = Math.floor(lat / CELL_DEG);
  const cell = `${x}:${y}`;
  // Rolled already in this window (a token lying there, taken, or nothing came up).
  const { count } = await admin
    .from("cruise_drops")
    .select("id", { count: "exact", head: true })
    .eq("cell", cell)
    .gt("expires_at", new Date().toISOString());
  if ((count ?? 0) > 0) return 0;
  const cx = (x + 0.5) * CELL_DEG, cy = (y + 0.5) * CELL_DEG;
  const expires = new Date(Date.now() + LIFETIME_HOURS * 3600_000).toISOString();
  const spot = Math.random() < CHANCE ? await sideStreetSpot(cx, cy, 0, 270) : null;
  if (!spot) {
    // Nothing this time: a marker (already "taken", never shown).
    await admin.from("cruise_drops").insert({ cell, lng: cx, lat: cy, expires_at: expires, taken_at: new Date().toISOString() });
    return 0;
  }
  const { error } = await admin.from("cruise_drops").insert({ cell, lng: spot.lng, lat: spot.lat, expires_at: expires });
  return error ? 0 : 1;
}
