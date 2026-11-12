import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { overpass } from "@/lib/fill-area";

/** How far the police take someone (take_to_station allows 15 km). */
const REACH_M = 15_000;
/** A square (0.1°, ~11 km) whose police stations have been looked up, kept; looked up again after this. */
const LOOK_AGAIN_MS = 30 * 24 * 3600_000;

type Spot = { id: number; name: string; lng: number; lat: number; metres: number };

/**
 * GET /api/world/police?lng=…&lat=…: the nearest police station (within 15 km) to a point, for the idling law (owner,
 * 12 Nov 2026: "They should be driving to the police station. That is where the lock up should happen"). From our own
 * places; the first time anyone needs one around here, OpenStreetMap's (amenity=police) are brought in and kept. Null:
 * none near (the police post by the road, then). Signed-in players only.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });
  const lng = Number(request.nextUrl.searchParams.get("lng"));
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return Response.json({ error: "Where?" }, { status: 400 });

  const admin = createAdminClient();
  const nearest = async () => {
    const { data } = await admin.rpc("places_near", { p_kinds: ["police"], p_lng: lng, p_lat: lat, p_limit: 1 });
    const s = ((data ?? []) as Spot[])[0];
    return s && s.metres <= REACH_M ? s : null;
  };
  const known = await nearest();
  if (known) return Response.json({ station: { name: known.name, lng: known.lng, lat: known.lat, metres: known.metres } });

  const cell = `${Math.floor(lng / 0.1)}_${Math.floor(lat / 0.1)}`;
  const { data: looked } = await admin.from("police_lookups").select("looked_at").eq("cell", cell).maybeSingle();
  if (looked && Date.now() - Date.parse(looked.looked_at) < LOOK_AGAIN_MS) return Response.json({ station: null });
  try {
    const found = await overpass(
      `[out:json][timeout:25];(node["amenity"="police"](around:${REACH_M},${lat},${lng});way["amenity"="police"](around:${REACH_M},${lat},${lng}););out center 60;`,
      { rounds: 1, seconds: 30 },
    );
    const rows = found
      .map((e) => {
        const at = e.type === "node" ? { lat: e.lat, lon: e.lon } : e.center;
        if (at?.lat == null || at.lon == null) return null;
        const name = (e.tags?.["name:en"] ?? e.tags?.name ?? "").trim();
        return { kind: "police", name: name ? (/police|station|post|division|precinct|commissariat|polic/i.test(name) ? name : `${name} police station`) : "Police station", lng: +at.lon.toFixed(6), lat: +at.lat.toFixed(6) };
      })
      .filter((r): r is { kind: string; name: string; lng: number; lat: number } => !!r);
    if (rows.length) await admin.from("places").insert(rows);
    await admin.from("police_lookups").upsert({ cell, looked_at: new Date().toISOString(), found: rows.length });
  } catch {
    // The service busy: none this time (the roadside post); asked again next time
  }
  const after = await nearest();
  return Response.json({ station: after ? { name: after.name, lng: after.lng, lat: after.lat, metres: after.metres } : null });
}
