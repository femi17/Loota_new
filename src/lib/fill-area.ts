import type { SupabaseClient } from "@supabase/supabase-js";
import { inNigeria } from "@/game/journey";
import { DEFAULT_NAME, busStopOf, kindOf, type PlaceKind, type Tags } from "@/lib/osm-places";

/**
 * The world beyond Nigeria (owner, 27 Oct 2026, in the United States: "I cannot pump my tire at the gas station… when I
 * pass bus signs on the map my bus icon is not lit up"). Petrol stations, places to eat and rest, tyre shops,
 * mechanics, hospitals and bus stops were imported for Nigeria only (scripts/build-places.mts, build-transit.mts). Each
 * square of AREA_DEG a hunter comes to elsewhere is filled once from OpenStreetMap (the Overpass service) and kept
 * (filled_areas): the square they're in first, then the ones around it, one per call.
 */
const AREA_DEG = 0.05; // ~5.5 km: small enough for a busy city's square to come back quickly
/** OpenStreetMap's query service: the main server, then public copies of it. */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const RETRY_AFTER_MS = 15 * 60_000; // a square that failed (the service busy) is tried again after this

type Element = { type: "node" | "way" | "relation"; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Tags };

const cellOf = (lng: number, lat: number) => ({ ix: Math.floor(lng / AREA_DEG), iy: Math.floor(lat / AREA_DEG) });
const keyOf = (ix: number, iy: number) => `${ix}_${iy}`;

/** Fills the nearest square around (lng, lat) that isn't filled yet, if any. Returns its key, or null. */
export async function fillArea(admin: SupabaseClient, lng: number, lat: number): Promise<string | null> {
  if (inNigeria({ lng, lat })) return null;
  const { ix, iy } = cellOf(lng, lat);
  const around: { key: string; ix: number; iy: number; d: number }[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const cx = (ix + dx + 0.5) * AREA_DEG;
      const cy = (iy + dy + 0.5) * AREA_DEG;
      around.push({ key: keyOf(ix + dx, iy + dy), ix: ix + dx, iy: iy + dy, d: Math.hypot(cx - lng, cy - lat) });
    }
  around.sort((a, b) => a.d - b.d);
  const { data: known } = await admin.from("filled_areas").select("cell, filled_at, failed_at").in("cell", around.map((a) => a.key));
  const state = new Map((known ?? []).map((k) => [k.cell as string, k]));
  const next = around.find((a) => {
    const k = state.get(a.key);
    return !k || (!k.filled_at && k.failed_at && Date.now() - Date.parse(k.failed_at) > RETRY_AFTER_MS);
  });
  if (!next) return null;

  // Claim it, so two hunters arriving together don't fill it twice.
  const claim = state.get(next.key)
    ? await admin.from("filled_areas").update({ started_at: new Date().toISOString(), failed_at: null }).eq("cell", next.key).not("failed_at", "is", null).select("cell")
    : await admin.from("filled_areas").insert({ cell: next.key }).select("cell");
  if (claim.error || !claim.data?.length) return null;

  try {
    const { places, stops } = await fetchSquare(next.ix, next.iy);
    for (let i = 0; i < places.length; i += 500) {
      const { error } = await admin.from("places").insert(places.slice(i, i + 500));
      if (error) throw error;
    }
    for (let i = 0; i < stops.length; i += 500) {
      const { error } = await admin.from("transit_stops").insert(stops.slice(i, i + 500));
      if (error) throw error;
    }
    await admin.from("filled_areas").update({ filled_at: new Date().toISOString(), places: places.length, stops: stops.length }).eq("cell", next.key);
  } catch (e) {
    console.error(`fillArea ${next.key}:`, e);
    await admin.from("filled_areas").update({ failed_at: new Date().toISOString() }).eq("cell", next.key);
  }
  return next.key;
}

/** One square's places and bus stops from OpenStreetMap. */
async function fetchSquare(ix: number, iy: number) {
  const s = iy * AREA_DEG;
  const w = ix * AREA_DEG;
  const box = `${s},${w},${s + AREA_DEG},${w + AREA_DEG}`;
  const query = `[out:json][timeout:60];
(
  nwr["amenity"~"^(fuel|hospital|clinic|restaurant|fast_food|cafe|food_court|bus_station)$"](${box});
  nwr["healthcare"~"^(hospital|clinic)$"](${box});
  nwr["shop"~"^(tyres|car_repair|motorcycle_repair)$"](${box});
  nwr["craft"="mechanic"](${box});
  nwr["leisure"~"^(park|garden)$"](${box});
  node["highway"="bus_stop"](${box});
  node["public_transport"~"^(platform|stop_position)$"]["bus"="yes"](${box});
);
out center tags;`;
  // The public servers are often busy (502, 429, 504): the next one, then round again after a pause.
  let elements: Element[] | null = null;
  let last = "";
  for (let round = 0; round < 2 && !elements; round++) {
    if (round) await new Promise((r) => setTimeout(r, 5000));
    for (const server of OVERPASS) {
      try {
        const res = await fetch(server, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Loota/1.0 (treasure-hunt game)" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        elements = ((await res.json()) as { elements: Element[] }).elements;
        break;
      } catch (e) {
        last = `${new URL(server).host}: ${e instanceof Error ? e.message : e}`;
      }
    }
  }
  if (!elements) throw new Error(`Overpass busy (${last})`);

  const places: { kind: PlaceKind; name: string; lng: number; lat: number }[] = [];
  const stops: { kind: "bus"; name: string; lng: number; lat: number; park: boolean }[] = [];
  const inside = (lng: number, lat: number) => lng >= w && lng < w + AREA_DEG && lat >= s && lat < s + AREA_DEG;
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat === undefined || lng === undefined || !el.tags || !inside(lng, lat)) continue; // the next square has it
    const kind = kindOf(el.tags);
    if (kind) places.push({ kind, name: el.tags.name ?? DEFAULT_NAME[kind], lng: +lng.toFixed(6), lat: +lat.toFixed(6) });
    const bus = busStopOf(el.tags);
    if (bus) {
      // One stop for the pole, the platform and the stopping spot drawn a few metres apart (as build-transit does).
      const park = bus === "park";
      const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
      const near = stops.find((b) => Math.hypot((b.lng - lng) * kx, (b.lat - lat) * 110_574) < (park ? 80 : 30));
      if (near) near.park ||= park;
      else stops.push({ kind: "bus", name: el.tags.name ?? (park ? "Bus station" : "Bus stop"), lng: +lng.toFixed(6), lat: +lat.toFixed(6), park });
    }
  }
  return { places, stops };
}
