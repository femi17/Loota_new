/**
 * A hunter followed along the roads on the broadcast (owner, 8 Nov 2026: "In an attempt for the avatar to catch up with
 * the users avatar. They travel along a path, and is not the path, like crossing roads or walking on buildings"). Each
 * position heard is joined to the last one by the shortest way along the roads (not a straight line across the block),
 * and the hunter is drawn gliding along that way, a moment behind the newest position, plus a short guess ahead along
 * the road they're on (by their speed) so the broadcast keeps step with the hunter's own screen.
 */
import * as geo from "./geo";
import * as roads from "./roads";
import { alongPath, cumulativeOf } from "./transit";
import type { LngLat } from "./geo";

type Coord = [number, number];

export type Follow = {
  /** The way they went, joined along the roads; drawn `s` metres along it. */
  pts: Coord[];
  cum: number[];
  s: number;
  heading: number;
  /** The newest position heard, when (ms, this page's clock), and the speed along the way (m/s). */
  last: { lng: number; lat: number; at: number };
  speed: number;
};

/** Further than this between two positions heard: a jump (a flight, a teleport by the server), not travel. */
export const FOLLOW_JUMP_M = 400;

const len = (a: Coord, b: Coord) => geo.distanceM(a, b);

/** A position this close to a road is on it (the game keeps hunters on the roads; tiles round to about a metre). */
const ON_ROAD_M = 10;

/** The way from `a` to `b` along the roads, or a straight line when the roads don't lead there sensibly. */
export function roadWay(net: roads.RoadNetwork | null, a: LngLat, b: LngLat, heading: number): Coord[] {
  const straight = geo.distanceM([a.lng, a.lat], [b.lng, b.lat]);
  if (!net || straight < 6) return [[a.lng, a.lat], [b.lng, b.lat]];
  const from = roads.snapToNetwork(net, a, heading);
  if (!from) return [[a.lng, a.lat], [b.lng, b.lat]];
  const onRoad = roads.positionOf(net, from);
  if (geo.distanceM([a.lng, a.lat], [onRoad.lng, onRoad.lat]) > ON_ROAD_M) return [[a.lng, a.lat], [b.lng, b.lat]];
  const path = roads.findPath(net, from, b, ON_ROAD_M);
  if (!path || path.length < 2) return [[a.lng, a.lat], [b.lng, b.lat]];
  const way: Coord[] = [[a.lng, a.lat], ...path, [b.lng, b.lat]];
  const total = cumulativeOf(way).at(-1) ?? 0;
  // A long way round for a short hop (a missing road piece, the wrong side of a dual carriageway): the straight line.
  return total > straight * 2.5 + 40 ? [[a.lng, a.lat], [b.lng, b.lat]] : way;
}

/** A position heard: joined to the way so far along the roads (or the start of a new way after a jump). */
export function heard(f: Follow | null, p: LngLat, at: number, net: roads.RoadNetwork | null): Follow {
  if (!f || geo.distanceM([f.last.lng, f.last.lat], [p.lng, p.lat]) > FOLLOW_JUMP_M) {
    return { pts: [[p.lng, p.lat]], cum: [0], s: 0, heading: f?.heading ?? 0, last: { lng: p.lng, lat: p.lat, at }, speed: 0 };
  }
  const way = roadWay(net, f.last, p, f.heading);
  const added = cumulativeOf(way).at(-1) ?? 0;
  for (const c of way.slice(1)) {
    const prev = f.pts[f.pts.length - 1];
    const d = len(prev, c);
    if (d < 0.05) continue;
    f.pts.push(c);
    f.cum.push(f.cum[f.cum.length - 1] + d);
  }
  const secs = Math.max(0.05, (at - f.last.at) / 1000);
  // The speed along the way: from positions a second or so apart; a long wait (standing still, a gap) means slower.
  f.speed = secs > 3 ? added / secs : f.speed * 0.4 + (added / secs) * 0.6;
  f.last = { lng: p.lng, lat: p.lat, at };
  // Keep the way short: drop what's well behind where they're drawn.
  if (f.pts.length > 60 && f.s > 100) {
    let cut = 0;
    while (cut < f.pts.length - 2 && f.cum[cut + 1] < f.s - 50) cut++;
    if (cut > 0) {
      const base = f.cum[cut];
      f.pts = f.pts.slice(cut);
      f.cum = f.cum.slice(cut).map((m) => m - base);
      f.s -= base;
    }
  }
  return f;
}

/**
 * Where to draw them now (`now`: ms on this page's clock; `dt`: seconds since the last frame): along the way toward the
 * newest position, and a little beyond it along the road they're on (at most 0.8 s at their speed, only while fresh;
 * straight on where no road is known).
 */
export function drawn(f: Follow, now: number, dt: number, net: roads.RoadNetwork | null): LngLat & { heading: number } {
  const total = f.cum[f.cum.length - 1];
  const end = f.pts[f.pts.length - 1];
  if (f.pts.length < 2) return { lng: end[0], lat: end[1], heading: f.heading }; // one position so far: there
  const prev = f.pts[f.pts.length - 2];
  const since = (now - f.last.at) / 1000;
  let extra: Coord | null = null;
  let extraM = 0;
  if (f.speed > 0.3 && since < 3) {
    extraM = Math.min(0.8, since + 0.1) * f.speed;
    const aim = geo.headingOf(prev, end);
    const rp = net ? roads.snapToNetwork(net, { lng: end[0], lat: end[1] }, aim) : null;
    const on = rp && net ? roads.positionOf(net, rp) : null;
    if (rp && on && geo.distanceM(end, [on.lng, on.lat]) < ON_ROAD_M) {
      // On a road: on along it.
      const ahead = roads.positionOf(net!, roads.advance(net!, rp, extraM, aim).position);
      extra = [ahead.lng, ahead.lat];
    } else {
      // No road known here (not loaded, or off the map's roads): straight on, the way they were going.
      const d = len(prev, end);
      extra = d > 0.05 ? [end[0] + ((end[0] - prev[0]) * extraM) / d, end[1] + ((end[1] - prev[1]) * extraM) / d] : null;
    }
    if (!extra) extraM = 0;
  }
  const target = total + extraM;
  const gap = target - f.s;
  f.s = gap > FOLLOW_JUMP_M ? target : f.s + gap * Math.min(1, 10 * dt);
  let pos: Coord;
  let a: Coord, b: Coord;
  if (f.s <= total || !extra) {
    const at = alongPath(f.pts, f.cum, Math.min(f.s, total));
    pos = at.pos;
    a = f.pts[Math.max(0, at.segment - 1)];
    b = f.pts[Math.min(f.pts.length - 1, Math.max(1, at.segment))];
  } else {
    const k = Math.min(1, (f.s - total) / (extraM || 1));
    pos = [end[0] + (extra[0] - end[0]) * k, end[1] + (extra[1] - end[1]) * k];
    a = end;
    b = extra;
  }
  if (a && b && len(a, b) > 0.05) f.heading = geo.turnTowards(f.heading, geo.headingOf(a, b), Math.min(1, 8 * dt));
  return { lng: pos[0], lat: pos[1], heading: f.heading };
}
