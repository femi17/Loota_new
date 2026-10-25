import type { SupabaseClient } from "@supabase/supabase-js";
import { nearestSideStreet } from "@/lib/road-cells";

/**
 * Find the street spots of places near a point that don't have one checked yet (places.street_*): a spot on an
 * ordinary street within 200 m, clear of main roads, where a Detour at that place is held (owner, 25 Oct 2026:
 * "inside the streets"). `limit` places at a time, nearest first. Returns how many were checked.
 */
export async function fillPlaceStreets(admin: SupabaseClient, lng: number, lat: number, limit = 15, boxDeg = 0.04): Promise<number> {
  const { data: places } = await admin
    .from("places")
    .select("id, lng, lat")
    .is("street_checked_at", null)
    .gte("lng", lng - boxDeg)
    .lte("lng", lng + boxDeg)
    .gte("lat", lat - boxDeg)
    .lte("lat", lat + boxDeg)
    .limit(400);
  if (!places?.length) return 0;
  const near = places
    .map((p) => ({ ...p, d: Math.hypot(p.lng - lng, p.lat - lat) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
  for (const p of near) {
    const spot = await nearestSideStreet(p.lng, p.lat, 200, 30);
    await admin
      .from("places")
      .update({ street_lng: spot?.lng ?? null, street_lat: spot?.lat ?? null, street_checked_at: new Date().toISOString() })
      .eq("id", p.id);
  }
  return near.length;
}
