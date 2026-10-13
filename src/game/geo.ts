/** Geography helpers shared by the map, movement engine and (later) server checks. */

export type LngLat = { lng: number; lat: number };
export type Coord = [lng: number, lat: number];

/** A polyline with cumulative distances, for moving along it by metres. */
export type Route = { coords: Coord[]; cum: number[]; total: number };

const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: Coord, b: Coord): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function buildRoute(coords: Coord[]): Route {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distanceM(coords[i - 1], coords[i]));
  return { coords, cum, total: cum[cum.length - 1] };
}

/** The point `s` metres along a route, plus the segment it lies on. */
export function pointAt(route: Route, s: number): LngLat & { a: Coord; b: Coord } {
  let i = 1;
  while (i < route.cum.length - 1 && route.cum[i] < s) i++;
  const a = route.coords[i - 1];
  const b = route.coords[i];
  const seg = route.cum[i] - route.cum[i - 1] || 1e-9;
  const t = Math.min(1, Math.max(0, (s - route.cum[i - 1]) / seg));
  return { lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, a, b };
}

/**
 * Heading in 3D scene space (x = east, z = south; models face +z), in radians.
 * Compass bearing in degrees = 180 − heading in degrees.
 */
export function headingOf(a: Coord, b: Coord): number {
  const dx = (b[0] - a[0]) * Math.cos(toRad(a[1]));
  const dz = -(b[1] - a[1]);
  return Math.atan2(dx, dz);
}

export function compassFromHeading(heading: number): number {
  return 180 - (heading * 180) / Math.PI;
}

/** Turn an angle part of the way towards a target, the short way round. */
export function turnTowards(current: number, target: number, k: number): number {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * k;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
