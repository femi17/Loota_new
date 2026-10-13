/**
 * Free roam that stays on roads (design decision 12 Oct 2026). Builds a small
 * road graph around the player from the map's own vector tiles, keeps the
 * player on it, and at junctions takes the road closest to where they aim.
 */
import type { Coord, LngLat } from "./geo";
import type { Mode } from "./movement";

/** A road line as it comes from the map tiles (OpenMapTiles "transportation" layer). */
export type RoadFeature = {
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
};

type RoadNode = { lng: number; lat: number; edges: number[] };
type RoadEdge = { a: number; b: number; length: number };

export type RoadNetwork = { nodes: RoadNode[]; edges: RoadEdge[]; centre: LngLat };

/** Where a player is on the network: an edge, how far along it (0 = node a, 1 = node b), and which way they face. */
export type RoadPosition = { edge: number; t: number; dir: 1 | -1 };

const NOT_ROADS = new Set(["rail", "transit", "ferry", "raceway", "bus_guideway", "aerialway"]);

/** Which roads a travel mode may use. */
function allowed(mode: Mode, props: Record<string, unknown> | null) {
  const cls = String(props?.class ?? "");
  if (!cls || NOT_ROADS.has(cls) || cls === "motorway") return false;
  if (mode === "bicycle" && props?.subclass === "steps") return false;
  return true;
}

/** Local flat projection around a point: metres east (x) and north (y). */
function projector(origin: LngLat) {
  const kx = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110574;
  return (p: { lng: number; lat: number }) => ({ x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * ky });
}

/** Build a road graph from tile features within `radiusM` of `centre`. */
export function buildNetwork(features: RoadFeature[], mode: Mode, centre: LngLat, radiusM = 900): RoadNetwork {
  const nodes: RoadNode[] = [];
  const edges: RoadEdge[] = [];
  const byKey = new Map<string, number>();
  const seen = new Set<string>();
  const local = projector(centre);

  // Tiles split roads at their edges; rounding to ~1 m joins the pieces back up.
  const nodeAt = (c: Coord) => {
    const key = `${Math.round(c[0] * 1e5)},${Math.round(c[1] * 1e5)}`;
    let id = byKey.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ lng: c[0], lat: c[1], edges: [] });
      byKey.set(key, id);
    }
    return id;
  };

  const addLine = (line: Coord[]) => {
    for (let i = 1; i < line.length; i++) {
      const p = local({ lng: line[i - 1][0], lat: line[i - 1][1] });
      const q = local({ lng: line[i][0], lat: line[i][1] });
      if (Math.min(Math.hypot(p.x, p.y), Math.hypot(q.x, q.y)) > radiusM) continue;
      const a = nodeAt(line[i - 1]);
      const b = nodeAt(line[i]);
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue; // the same road from two overlapping tiles
      seen.add(key);
      const id = edges.length;
      edges.push({ a, b, length: Math.hypot(q.x - p.x, q.y - p.y) });
      nodes[a].edges.push(id);
      nodes[b].edges.push(id);
    }
  };

  for (const f of features) {
    if (!allowed(mode, f.properties)) continue;
    if (f.geometry.type === "LineString") addLine(f.geometry.coordinates as Coord[]);
    else if (f.geometry.type === "MultiLineString") (f.geometry.coordinates as Coord[][]).forEach(addLine);
  }

  return { nodes, edges, centre };
}

/** Scene heading (see geo.headingOf) of travel along an edge in a direction. */
function edgeHeading(net: RoadNetwork, edge: number, dir: 1 | -1) {
  const e = net.edges[edge];
  const from = net.nodes[dir === 1 ? e.a : e.b];
  const to = net.nodes[dir === 1 ? e.b : e.a];
  const dx = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180);
  const dz = -(to.lat - from.lat);
  return Math.atan2(dx, dz);
}

const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Snap a point to the nearest road, facing whichever way is closest to `heading`. */
export function snapToNetwork(net: RoadNetwork, pos: LngLat, heading: number): RoadPosition | null {
  const local = projector(pos);
  let edge = -1;
  let t = 0;
  let nearest = Infinity;
  for (let i = 0; i < net.edges.length; i++) {
    const e = net.edges[i];
    const a = local(net.nodes[e.a]);
    const b = local(net.nodes[e.b]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-9;
    const along = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    const d = Math.hypot(a.x + dx * along, a.y + dy * along);
    if (d < nearest) {
      nearest = d;
      edge = i;
      t = along;
    }
  }
  if (edge < 0) return null;
  const dir: 1 | -1 = angleBetween(edgeHeading(net, edge, 1), heading) <= Math.PI / 2 ? 1 : -1;
  return { edge, t, dir };
}

export function positionOf(net: RoadNetwork, rp: RoadPosition): LngLat & { heading: number } {
  const e = net.edges[rp.edge];
  const a = net.nodes[e.a];
  const b = net.nodes[e.b];
  return { lng: a.lng + (b.lng - a.lng) * rp.t, lat: a.lat + (b.lat - a.lat) * rp.t, heading: edgeHeading(net, rp.edge, rp.dir) };
}

/** Turn round on the current road. */
export function reverse(rp: RoadPosition): RoadPosition {
  return { ...rp, dir: rp.dir === 1 ? -1 : 1 };
}

/** Facing more than this far from where the player aims counts as asking for a U-turn. */
export const U_TURN_ANGLE = (135 * Math.PI) / 180;

export function wantsUTurn(net: RoadNetwork, rp: RoadPosition, aim: number) {
  return angleBetween(edgeHeading(net, rp.edge, rp.dir), aim) > U_TURN_ANGLE;
}

/**
 * Move `distance` metres along the roads. At each junction, take the road whose
 * direction is closest to `aim`; at a dead end, turn round and stop.
 */
export function advance(net: RoadNetwork, rp: RoadPosition, distance: number, aim: number): { position: RoadPosition; stopped: boolean } {
  let { edge, t, dir } = rp;
  let remaining = distance;

  for (let hops = 0; remaining > 0 && hops < 50; hops++) {
    const e = net.edges[edge];
    const toEnd = (dir === 1 ? 1 - t : t) * e.length;
    if (remaining < toEnd) {
      t += (dir * remaining) / (e.length || 1e-9);
      return { position: { edge, t, dir }, stopped: false };
    }
    remaining -= toEnd;
    const node = dir === 1 ? e.b : e.a;
    const options = net.nodes[node].edges.filter((id) => id !== edge);
    if (options.length === 0) {
      // Dead end: stop here, facing back the way you came.
      return { position: { edge, t: dir === 1 ? 1 : 0, dir: dir === 1 ? -1 : 1 }, stopped: true };
    }
    let next = options[0];
    let nextDir: 1 | -1 = net.edges[next].a === node ? 1 : -1;
    let bestAngle = Infinity;
    for (const id of options) {
      const d: 1 | -1 = net.edges[id].a === node ? 1 : -1;
      const angle = angleBetween(edgeHeading(net, id, d), aim);
      if (angle < bestAngle) {
        bestAngle = angle;
        next = id;
        nextDir = d;
      }
    }
    edge = next;
    dir = nextDir;
    t = dir === 1 ? 0 : 1;
  }
  return { position: { edge, t, dir }, stopped: false };
}
