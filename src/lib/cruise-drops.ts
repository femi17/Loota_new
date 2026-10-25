import type { SupabaseClient } from "@supabase/supabase-js";
import { CELL_DEG } from "@/game/items";
import { sideStreetSpot } from "@/lib/road-cells";

/** How long a token lies in the street before it's gone. */
const LIFETIME_HOURS = 3;

/**
 * Cruise tokens in the streets (owner, 25 Oct 2026): keep two lying on the side streets of the square around a player
 * (the same squares as finds, ~550 m), each on an ordinary street off the main roads. Only adds when the square has
 * none left; a square with no side streets stays empty.
 */
export async function stockCruise(admin: SupabaseClient, lng: number, lat: number): Promise<number> {
  const x = Math.floor(lng / CELL_DEG), y = Math.floor(lat / CELL_DEG);
  const cell = `${x}:${y}`;
  const { count } = await admin
    .from("cruise_drops")
    .select("id", { count: "exact", head: true })
    .eq("cell", cell)
    .is("taken_at", null)
    .gt("expires_at", new Date().toISOString());
  if ((count ?? 0) > 0) return 0;
  const cx = (x + 0.5) * CELL_DEG, cy = (y + 0.5) * CELL_DEG;
  const spots = (await Promise.all([sideStreetSpot(cx, cy, 0, 270), sideStreetSpot(cx, cy, 0, 270)])).filter((s) => s !== null);
  if (!spots.length) return 0;
  const expires = new Date(Date.now() + LIFETIME_HOURS * 3600_000).toISOString();
  const { error } = await admin.from("cruise_drops").insert(spots.map((s) => ({ cell, lng: s.lng, lat: s.lat, expires_at: expires })));
  return error ? 0 : spots.length;
}
