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
const FOOT_ONLY = new Set(["path", "pedestrian"]);

/** Which roads a travel mode may use: motor vehicles stay off footpaths, walkers and bikes off motorways. */
function allowed(mode: Mode, props: Record<string, unknown> | null) {
  const cls = String(props?.class ?? "");
  if (!cls || NOT_ROADS.has(cls)) return false;
  if (mode === "motorbike" || mode === "car") return !FOOT_ONLY.has(cls);
  if (cls === "motorway") return false;
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
export function buildNetwork(features: RoadFeature[], mode: Mode, centre: LngLat, radiusM = 1500): RoadNetwork {
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

  joinLooseEnds(nodes, edges, local);
  return { nodes, edges, centre };
}

/**
 * Map tiles cut roads at their edges and simplify junctions, so a side street
 * often stops exactly on another road without sharing a point with it. Join
 * every loose road end to the nearest road within a few metres (splitting that
 * road where they meet) so these don't look like dead ends.
 */
function joinLooseEnds(nodes: RoadNode[], edges: RoadEdge[], local: (p: { lng: number; lat: number }) => { x: number; y: number }) {
  const JOIN_M = 4;
  const CELL_M = 25;
  const xy = nodes.map((n) => local(n));
  const grid = new Map<string, number[]>(); // edge ids by grid cell

  const addToGrid = (id: number) => {
    const a = xy[edges[id].a];
    const b = xy[edges[id].b];
    const x0 = Math.floor((Math.min(a.x, b.x) - JOIN_M) / CELL_M);
    const x1 = Math.floor((Math.max(a.x, b.x) + JOIN_M) / CELL_M);
    const y0 = Math.floor((Math.min(a.y, b.y) - JOIN_M) / CELL_M);
    const y1 = Math.floor((Math.max(a.y, b.y) + JOIN_M) / CELL_M);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(id);
        else grid.set(key, [id]);
      }
    }
  };
  edges.forEach((_, id) => addToGrid(id));

  // Attach the loose end itself to the meeting point, rather than adding a tiny
  // connector: a piece only centimetres long has no meaningful direction, and
  // junction turns are decided by direction.
  const attach = (end: number, target: number) => {
    const id = nodes[end].edges[0];
    const e = edges[id];
    const other = e.a === end ? e.b : e.a;
    if (other === target) return; // would fold the road onto itself
    if (e.a === end) e.a = target;
    else e.b = target;
    e.length = Math.max(0.01, Math.hypot(xy[other].x - xy[target].x, xy[other].y - xy[target].y));
    nodes[end].edges = [];
    nodes[target].edges.push(id);
    addToGrid(id);
  };

  const looseEnds = nodes.flatMap((n, i) => (n.edges.length === 1 ? [i] : []));
  for (const i of looseEnds) {
    if (nodes[i].edges.length !== 1) continue; // already joined
    const p = xy[i];
    let bestEdge = -1;
    let bestT = 0;
    let bestD = JOIN_M;
    for (const id of grid.get(`${Math.floor(p.x / CELL_M)},${Math.floor(p.y / CELL_M)}`) ?? []) {
      const e = edges[id];
      if (e.a === i || e.b === i) continue;
      const a = xy[e.a];
      const b = xy[e.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-9)));
      const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
      if (d < bestD) {
        bestD = d;
        bestEdge = id;
        bestT = t;
      }
    }
    if (bestEdge < 0) continue;

    const e = edges[bestEdge];
    let target: number;
    if (bestT * e.length < 0.5) target = e.a;
    else if ((1 - bestT) * e.length < 0.5) target = e.b;
    else {
      // Split the road at the meeting point.
      target = nodes.length;
      const a = nodes[e.a];
      const b = nodes[e.b];
      nodes.push({ lng: a.lng + (b.lng - a.lng) * bestT, lat: a.lat + (b.lat - a.lat) * bestT, edges: [] });
      xy.push(local(nodes[target]));
      const oldB = e.b;
      const tail = edges.length;
      edges.push({ a: target, b: oldB, length: e.length * (1 - bestT) });
      e.b = target;
      e.length *= bestT;
      nodes[target].edges.push(bestEdge, tail);
      const bEdges = nodes[oldB].edges;
      bEdges[bEdges.indexOf(bestEdge)] = tail;
      addToGrid(tail);
    }
    if (target !== i) attach(i, target);
  }
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

/**
 * The direction a road leaves `node` along edge `id`, judged over its first
 * ~10 m (following bends, stopping at the next junction), so small wiggles
 * and short pieces at junctions don't decide which way a road goes.
 */
function headingAway(net: RoadNetwork, node: number, id: number, lookM = 10) {
  let at = node;
  let edge = id;
  let travelled = 0;
  for (let hops = 0; hops < 20; hops++) {
    const e = net.edges[edge];
    at = e.a === at ? e.b : e.a;
    travelled += e.length;
    if (travelled >= lookM) break;
    const onward = net.nodes[at].edges.filter((x) => x !== edge);
    if (onward.length !== 1) break; // a junction or the end of the road
    edge = onward[0];
  }
  const from = net.nodes[node];
  const to = net.nodes[at];
  return Math.atan2((to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180), -(to.lat - from.lat));
}

/**
 * Snap a point to the nearest road, facing whichever way is closest to
 * `heading`. Roads within a few metres of each other (e.g. all the roads at a
 * junction) are tied, and the one lined up with `heading` wins.
 */
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
    // Up to 3 m extra for a road at right angles to the way the player faces.
    const off = angleBetween(edgeHeading(net, i, 1), heading);
    const score = d + (3 * Math.min(off, Math.PI - off)) / (Math.PI / 2);
    if (score < nearest) {
      nearest = score;
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

/** A road counts as going off to one side if it bends at least this much from straight on (and isn't a U-turn). */
const SIDE_MIN = (20 * Math.PI) / 180;
const SIDE_MAX = (170 * Math.PI) / 180;

/**
 * At a junction, the road leaving on the asked side (−1 left, +1 right) that
 * is closest to a square turn, for a player arriving with heading `straight`.
 * Any road off to that side will do, including sharp or shallow ones.
 */
function sideBranch(net: RoadNetwork, node: number, straight: number, turn: -1 | 1) {
  let best: { id: number; dir: 1 | -1; score: number } | null = null;
  for (const id of net.nodes[node].edges) {
    const d: 1 | -1 = net.edges[id].a === node ? 1 : -1;
    const h = headingAway(net, node, id);
    // Turning left raises the scene heading, turning right lowers it (see geo.headingOf).
    const side = -turn * Math.atan2(Math.sin(h - straight), Math.cos(h - straight));
    if (side < SIDE_MIN || side > SIDE_MAX) continue;
    const score = Math.abs(side - Math.PI / 2);
    if (!best || score < best.score) best = { id, dir: d, score };
  }
  return best;
}

/**
 * A junction the player just went through without turning (for a turn pressed
 * a moment too late). Kept by place, as the network is rebuilt as they travel.
 */
export type PassedJunction = { lng: number; lat: number; heading: number; metresSince: number };

/** Turn at a junction just passed: back to it and onto the side road. Null if no road goes that way. */
export function turnAtPassed(net: RoadNetwork, passed: PassedJunction, turn: -1 | 1): RoadPosition | null {
  const local = projector(passed);
  const node = net.nodes.findIndex((n) => {
    if (n.edges.length < 3) return false; // only real junctions
    const q = local(n);
    return Math.hypot(q.x, q.y) < 3;
  });
  if (node < 0) return null;
  const branch = sideBranch(net, node, passed.heading, turn);
  if (!branch) return null;
  return { edge: branch.id, t: branch.dir === 1 ? 0 : 1, dir: branch.dir };
}

/**
 * Turn at the junction the player is standing on: one a few metres ahead
 * (`maxAheadM`), or one just left behind on this road (`maxBackM`). Null if
 * there isn't one, or no road goes that way.
 */
export function turnHere(net: RoadNetwork, rp: RoadPosition, turn: -1 | 1, maxBackM = 30, maxAheadM = 8): RoadPosition | null {
  const e = net.edges[rp.edge];
  const ahead = rp.dir === 1 ? e.b : e.a;
  const behind = rp.dir === 1 ? e.a : e.b;
  const toAhead = (rp.dir === 1 ? 1 - rp.t : rp.t) * e.length;
  const toBehind = e.length - toAhead;
  const candidates: { node: number; straight: number }[] = [];
  // Arriving at the junction ahead: travelling the way it's reached along this road.
  if (toAhead <= maxAheadM && net.nodes[ahead].edges.length >= 3) candidates.push({ node: ahead, straight: headingAway(net, ahead, rp.edge) + Math.PI });
  if (toBehind <= maxBackM && net.nodes[behind].edges.length >= 3) candidates.push({ node: behind, straight: headingAway(net, behind, rp.edge) });
  for (const { node, straight } of candidates) {
    const branch = sideBranch(net, node, straight, turn);
    if (branch && branch.id !== rp.edge) return { edge: branch.id, t: branch.dir === 1 ? 0 : 1, dir: branch.dir };
  }
  return null;
}

/**
 * Move `distance` metres along the roads. At each real junction (two or more
 * ways on), take the road closest to `aim`; or, when `turn` is set (−1 left,
 * +1 right), any road leaving on that side, and report `turned`; otherwise
 * carry straight on and keep the turn for later. At a dead end, stop at the
 * end of the road (`deadEnd`), still facing it. `passed` is the last junction
 * gone straight through, with how far beyond it the player now is.
 */
export function advance(
  net: RoadNetwork,
  rp: RoadPosition,
  distance: number,
  aim: number,
  turn: -1 | 0 | 1 = 0,
): { position: RoadPosition; deadEnd: boolean; turned: boolean; passed: PassedJunction | null } {
  let { edge, t, dir } = rp;
  let remaining = distance;
  let turned = false;
  let passed: PassedJunction | null = null;

  for (let hops = 0; remaining > 0 && hops < 50; hops++) {
    const e = net.edges[edge];
    const toEnd = (dir === 1 ? 1 - t : t) * e.length;
    if (remaining < toEnd) {
      t += (dir * remaining) / (e.length || 1e-9);
      return { position: { edge, t, dir }, deadEnd: false, turned, passed };
    }
    remaining -= toEnd;
    const node = dir === 1 ? e.b : e.a;
    const options = net.nodes[node].edges.filter((id) => id !== edge);
    if (options.length === 0) {
      return { position: { edge, t: dir === 1 ? 1 : 0, dir }, deadEnd: true, turned, passed };
    }

    const closestTo = (heading: number) => {
      let best = { id: options[0], dir: (net.edges[options[0]].a === node ? 1 : -1) as 1 | -1, angle: Infinity };
      for (const id of options) {
        const d: 1 | -1 = net.edges[id].a === node ? 1 : -1;
        const angle = angleBetween(headingAway(net, node, id), heading);
        if (angle < best.angle) best = { id, dir: d, angle };
      }
      return best;
    };

    let choice: { id: number; dir: 1 | -1 } = closestTo(aim);
    const junction = options.length >= 2;
    const straight = headingAway(net, node, edge) + Math.PI; // the way the player arrived
    const branch = turn !== 0 && !turned && junction ? sideBranch(net, node, straight, turn) : null;
    if (branch) {
      choice = branch;
      turned = true;
    } else if (junction) {
      passed = { lng: net.nodes[node].lng, lat: net.nodes[node].lat, heading: straight, metresSince: remaining };
    }
    edge = choice.id;
    dir = choice.dir;
    t = dir === 1 ? 0 : 1;
  }
  return { position: { edge, t, dir }, deadEnd: false, turned, passed };
}
