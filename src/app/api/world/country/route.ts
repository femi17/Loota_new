import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** OpenStreetMap's search services ask every app to identify itself. */
const USER_AGENT = "Loota/0.1 (real-map treasure hunt game)";
const known = new Map<string, { code: string; name: string }>();

/**
 * GET /api/world/country?lng=…&lat=…: the country a point is in ({ code: "CA", name: "Canada" }), so the game speaks
 * and plays as that country does: its words, its people's names, its radio (owner, 27 Oct 2026: "it is not only
 * focused on Nigeria but the country which you find yourself"). Kept per ~10 km square. Signed-in players only.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });
  const lng = Number(request.nextUrl.searchParams.get("lng"));
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    return Response.json({ error: "Where?" }, { status: 400 });
  }
  const key = `${Math.round(lng * 10)},${Math.round(lat * 10)}`;
  const hit = known.get(key);
  if (hit) return Response.json(hit);
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}&lang=en&limit=1`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`photon ${res.status}`);
    const p = ((await res.json()) as { features: { properties: { countrycode?: string; country?: string } }[] }).features[0]?.properties;
    if (!p?.countrycode) return Response.json({ code: null, name: null }); // the open sea
    const found = { code: p.countrycode.toUpperCase(), name: p.country ?? p.countrycode };
    if (known.size > 5000) known.clear();
    known.set(key, found);
    return Response.json(found);
  } catch {
    return Response.json({ error: "Couldn't tell just now" }, { status: 503 });
  }
}
