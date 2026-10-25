import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Place } from "@/game/places";

/** OpenStreetMap's search services ask every app to identify itself. */
const USER_AGENT = "Loota/0.1 (real-map treasure hunt game)";
const recent = new Map<string, { at: number; places: Place[] }>();
const KEEP_MS = 10 * 60_000;

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
};

/** Photon (komoot): made for search-as-you-type, and favours places near the player. */
async function photon(q: string, lng: number, lat: number): Promise<Place[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${lat}&lon=${lng}&limit=6&lang=en`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const data = (await res.json()) as { features: PhotonFeature[] };
  return data.features.map(({ geometry, properties: p }) => {
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const name = p.name ?? street ?? "Unnamed place";
    const detail = [p.name ? street : null, p.district, p.city ?? p.county, p.state, p.country]
      .filter((part, i, all) => part && all.indexOf(part) === i && part !== name)
      .join(", ");
    return { name: name || "Unnamed place", detail, lng: geometry.coordinates[0], lat: geometry.coordinates[1] };
  });
}

/** Nominatim: OpenStreetMap's own search, used when Photon is down. */
async function nominatim(q: string, lng: number, lat: number): Promise<Place[]> {
  const box = [lng - 0.5, lat + 0.5, lng + 0.5, lat - 0.5].join(",");
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}&viewbox=${box}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const data = (await res.json()) as { name: string; display_name: string; lat: string; lon: string }[];
  return data.map((r) => {
    const name = r.name || r.display_name.split(",")[0];
    return { name, detail: r.display_name.replace(`${name}, `, ""), lng: Number(r.lon), lat: Number(r.lat) };
  });
}

const PLACE_KIND: Record<string, string> = { fuel: "Petrol station", hospital: "Hospital", eat: "Place to eat", rest: "Park", tyres: "Vulcanizer", mechanic: "Mechanic" };

/**
 * Our own named places first, in a fraction of a second (owner, 25 Oct 2026: a riddle gets only 15 seconds to name
 * its place): famous places (the old landmarks' list) and the places on our map whose names match.
 */
async function ours(q: string, lng: number, lat: number): Promise<Place[]> {
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const db = createAdminClient();
  const [famous, named] = await Promise.all([
    db.from("landmarks").select("name, city, lng, lat").ilike("name", like).limit(4),
    db.from("places").select("name, kind, lng, lat").ilike("name", like).limit(6),
  ]);
  const away = (p: { lng: number; lat: number }) => Math.hypot(p.lng - lng, p.lat - lat);
  return [
    ...(famous.data ?? []).sort((a, b) => away(a) - away(b)).map((l) => ({ name: l.name, detail: l.city, lng: l.lng, lat: l.lat })),
    ...(named.data ?? []).sort((a, b) => away(a) - away(b)).slice(0, 3).map((pl) => ({ name: pl.name, detail: PLACE_KIND[pl.kind] ?? "", lng: pl.lng, lat: pl.lat })),
  ];
}

/** OpenStreetMap's search: Photon, or Nominatim when Photon is down. */
async function openStreetMap(q: string, lng: number, lat: number): Promise<Place[]> {
  try {
    return await photon(q, lng, lat);
  } catch {
    return nominatim(q, lng, lat);
  }
}

/**
 * GET /api/geocode?q=…&lng=…&lat=…: places and addresses matching the search,
 * nearest the player first. Signed-in players only.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const lng = Number(params.get("lng"));
  const lat = Number(params.get("lat"));
  if (q.length < 3 || !Number.isFinite(lng) || !Number.isFinite(lat)) return Response.json({ places: [] });

  // Searches repeat a lot as people type; answer recent ones from memory.
  const key = `${q.toLowerCase()}|${lng.toFixed(2)}|${lat.toFixed(2)}`;
  const cached = recent.get(key);
  if (cached && Date.now() - cached.at < KEEP_MS) return Response.json({ places: cached.places });

  // Ours and OpenStreetMap's at once; when ours already has some, OpenStreetMap gets only a moment more.
  const world = openStreetMap(q, lng, lat).catch(() => null);
  const mine = await ours(q, lng, lat).catch(() => [] as Place[]);
  const theirs = mine.length ? await Promise.race([world, new Promise<null>((r) => setTimeout(() => r(null), 1200))]) : await world;
  if (!mine.length && !theirs) return Response.json({ error: "Place search is unavailable right now" }, { status: 502 });
  let places: Place[] = [...mine, ...(theirs ?? [])].slice(0, 8);
  // The same place is often mapped more than once (a building, its area, its entrance): keep the first.
  places = places.filter(
    (p, i) => !places.slice(0, i).some((q) => q.name === p.name && Math.abs(q.lng - p.lng) < 0.003 && Math.abs(q.lat - p.lat) < 0.003),
  );
  if (recent.size > 500) recent.clear();
  if (theirs) recent.set(key, { at: Date.now(), places }); // a short answer (OpenStreetMap too slow) isn't kept
  return Response.json({ places });
}
