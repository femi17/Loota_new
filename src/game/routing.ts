import { buildRoute, type Coord, type LngLat, type Route } from "./geo";
import { MODES, type Mode } from "./movement";

/**
 * A road route between two points from the free OpenStreetMap routing service
 * (fine for development; swap for a paid provider before launch). Falls back to
 * a straight line if the service is unavailable or takes over 12 seconds.
 */
export async function fetchRoute(from: LngLat, to: LngLat, mode: Mode): Promise<{ route: Route; fallback: boolean }> {
  const profile = MODES[mode].profile;
  const url = `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { routes?: { geometry?: { coordinates?: Coord[] } }[] };
    const coords = json.routes?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2) throw new Error("no route");
    // Start exactly where the player stands, then follow the road.
    return { route: buildRoute([[from.lng, from.lat], ...coords]), fallback: false };
  } catch {
    return { route: buildRoute([[from.lng, from.lat], [to.lng, to.lat]]), fallback: true };
  }
}
