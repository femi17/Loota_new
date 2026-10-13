/**
 * Turn-by-turn directions along a planned route. The player always steers;
 * these only say where the next turn is and which way (design decision
 * 13 Oct 2026: only buses, trains and planes move a player by themselves).
 */
import { distanceM, headingOf, pointAt, type Coord, type LngLat, type Route } from "./geo";

/**
 * A turn on the route: `s` metres along it; `angle` in radians (positive =
 * left). `keep`: a fork, where the way on is "keep left/right" rather than a turn.
 */
export type Maneuver = { s: number; angle: number; lng: number; lat: number; keep?: boolean };

const BEND = (35 * Math.PI) / 180; // smaller bends just follow the road
const LOOK_M = 12; // judge a bend over this far either side, so kinks in the line don't count

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Where the route turns; `forks` (from roads.findForks) add "keep left/right" steps. */
export function findManeuvers(route: Route, forks: { index: number; side: -1 | 1 }[] = []): Maneuver[] {
  const found: Maneuver[] = [];
  for (let i = 1; i < route.coords.length - 1; i++) {
    const s = route.cum[i];
    if (s < 5 || route.total - s < 5) continue;
    const before = pointAt(route, Math.max(0, s - LOOK_M));
    const after = pointAt(route, Math.min(route.total, s + LOOK_M));
    const here = route.coords[i];
    // Turning left raises the scene heading (see geo.headingOf).
    const angle = wrap(headingOf(here, [after.lng, after.lat]) - headingOf([before.lng, before.lat], here));
    if (Math.abs(angle) < BEND) continue;
    const last = found[found.length - 1];
    if (last && s - last.s < 15) {
      // One turn drawn as two bends close together: keep the sharper.
      if (Math.abs(angle) > Math.abs(last.angle)) found[found.length - 1] = { s, angle, lng: here[0], lat: here[1] };
      continue;
    }
    found.push({ s, angle, lng: here[0], lat: here[1] });
  }
  for (const { index, side } of forks) {
    const s = route.cum[index];
    if (found.some((m) => Math.abs(m.s - s) < 15)) continue;
    const [lng, lat] = route.coords[index];
    found.push({ s, angle: (-side * 25 * Math.PI) / 180, lng, lat, keep: true });
  }
  return found.sort((a, b) => a.s - b.s);
}

/**
 * How far along the route the player is (`s`, metres) and how far off it
 * (`off`, metres). `from` is the segment found last time, to search near it first.
 */
export function progressOn(route: Route, pos: LngLat, from = 0): { s: number; off: number; segment: number } {
  const k = Math.cos((pos.lat * Math.PI) / 180);
  const local = (c: Coord) => ({ x: (c[0] - pos.lng) * 111320 * k, y: (c[1] - pos.lat) * 110574 });
  let best = { s: 0, off: Infinity, segment: 0 };
  const check = (i: number) => {
    const a = local(route.coords[i]);
    const b = local(route.coords[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1e-9)));
    const off = Math.hypot(a.x + dx * t, a.y + dy * t);
    if (off < best.off) best = { s: route.cum[i] + t * (route.cum[i + 1] - route.cum[i]), off, segment: i };
  };
  const last = route.coords.length - 2;
  for (let i = Math.max(0, from - 30); i <= Math.min(last, from + 60); i++) check(i);
  if (best.off > 50) for (let i = 0; i <= last; i++) check(i); // jumped (or was moved): look everywhere
  return best;
}

/** The next turn after `s` metres along, if any. */
export function nextManeuver(maneuvers: Maneuver[], s: number): Maneuver | null {
  return maneuvers.find((m) => m.s > s + 3) ?? null;
}

/** Words for a turn: "turn left", "bear right", "turn sharp left", "make a U-turn", "keep left". */
export function turnWords(angle: number, keep = false): string {
  const side = angle > 0 ? "left" : "right";
  if (keep) return `keep ${side}`;
  const a = Math.abs(angle);
  if (a > (160 * Math.PI) / 180) return "make a U-turn";
  if (a > (120 * Math.PI) / 180) return `turn sharp ${side}`;
  if (a > (60 * Math.PI) / 180) return `turn ${side}`;
  return `bear ${side}`;
}

/** Distance in steps that are easy to read while moving: 40 m, 150 m, 1.2 km. */
export function roundedDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  if (m >= 100) return `${Math.round(m / 50) * 50} m`;
  return `${Math.max(5, Math.round(m / 10) * 10)} m`;
}

export { distanceM };
