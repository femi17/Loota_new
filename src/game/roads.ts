/**
 * Free roam that stays on roads (design decision 12 Oct 2026). Builds a small
 * road graph around the player from the map's own vector tiles, keeps the
 * player on it, and at junctions takes the road closest to where they aim.
 */
import type { Coord, LngLat } from "./geo";
import type { Mode } from "./movement";
import { ROAD_FLAGS, type RoadCellData, type RoadClass } from "./roadData";

/** A road line as it comes from the map tiles (OpenMapTiles "transportation" layer). */
export type RoadFeature = {
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
};

type RoadNode = { lng: number; lat: number; edges: number[] };
/** `level`: 1 on a bridge, −1 in a tunnel, 0 on the ground (roads only meet at the same level). */
/**
 * `oneway`: for motorbikes and cars on a one-way street, the only direction
 * allowed (1 = from a to b, −1 = from b to a). Walkers and cyclists ignore it.
 */
/**
 * `cls`, `stretch` and `urban` (our own roads only) decide traffic jams: the kind of road,
 * which stretch of it (the same on every device), and how built-up the area is (src/game/clock.ts).
 */
type RoadEdge = {
  a: number;
  b: number;
  length: number;
  level: number;
  name?: string | null;
  oneway?: 1 | -1;
  cls?: RoadClass;
  stretch?: number;
  urban?: number;
  /** No public access (an airport's airside, a private yard): walkable, but nobody should be put down there. */
  closed?: boolean;
};

/** How built-up a road square is, 0 (countryside) to 1 (a city), from how many roads it has. */
export function cellUrban(cell: RoadCellData) {
  return Math.max(0, Math.min(1, (cell.ways.length - 300) / 1500));
}

/** Squares (about 1.1 km) a go-slow covers along one road. */
const JAM_SQUARE_DEG = 0.01;

/**
 * A stretch of road for traffic: one named road (or one unnamed way) within a ~1.1 km square, so a go-slow
 * runs along the road for a kilometre or so, the same for every player. `at`: the start of the segment.
 * (It was ~25 points of one way, about 250 m: a motorbike was through a jam in 4 seconds and hardly noticed it.)
 */
export function jamStretch(way: RoadCellData["ways"][number], at: { lng: number; lat: number }) {
  let road = way.points[0];
  if (way.name) {
    road = 0;
    for (let k = 0; k < way.name.length; k++) road = (Math.imul(road, 31) + way.name.charCodeAt(k)) | 0;
  }
  const gx = Math.floor(at.lng / JAM_SQUARE_DEG);
  const gy = Math.floor(at.lat / JAM_SQUARE_DEG);
  return (Math.imul(road, 73856093) ^ Math.imul(gx, 19349663) ^ Math.imul(gy, 83492791)) | 0;
}

/** May the player travel along this road piece in this direction? */
const canGo = (e: RoadEdge, dir: 1 | -1) => !e.oneway || e.oneway === dir;

/** Is the player on a one-way street (for their mode)? */
export function isOneWay(net: RoadNetwork, rp: RoadPosition) {
  return !!net.edges[rp.edge]?.oneway;
}

/** `radius`: how far from `centre` the roads were loaded (pieces beyond it are cut off). */
export type RoadNetwork = { nodes: RoadNode[]; edges: RoadEdge[]; centre: LngLat; radius: number };

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

/** How close a segment (local metres) comes to the origin: a long straight country road can be one segment of
 *  several km, both ends far away while you ride along its middle. */
function reachOf(p: { x: number; y: number }, q: { x: number; y: number }) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const along = Math.max(0, Math.min(1, -(p.x * dx + p.y * dy) / (dx * dx + dy * dy || 1e-9)));
  return Math.hypot(p.x + dx * along, p.y + dy * along);
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

  const addLine = (line: Coord[], level: number, closed: boolean) => {
    for (let i = 1; i < line.length; i++) {
      const p = local({ lng: line[i - 1][0], lat: line[i - 1][1] });
      const q = local({ lng: line[i][0], lat: line[i][1] });
      if (reachOf(p, q) > radiusM) continue;
      const a = nodeAt(line[i - 1]);
      const b = nodeAt(line[i]);
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue; // the same road from two overlapping tiles
      seen.add(key);
      const id = edges.length;
      edges.push({ a, b, length: Math.hypot(q.x - p.x, q.y - p.y), level, ...(closed && { closed }) });
      nodes[a].edges.push(id);
      nodes[b].edges.push(id);
    }
  };

  for (const f of features) {
    if (!allowed(mode, f.properties)) continue;
    const brunnel = f.properties?.brunnel;
    const level = brunnel === "bridge" ? 1 : brunnel === "tunnel" ? -1 : 0;
    const closed = f.properties?.access === "no" || f.properties?.access === "private";
    if (f.geometry.type === "LineString") addLine(f.geometry.coordinates as Coord[], level, closed);
    else if (f.geometry.type === "MultiLineString") for (const line of f.geometry.coordinates as Coord[][]) addLine(line, level, closed);
  }

  joinCrossings(nodes, edges, local);
  joinLooseEnds(nodes, edges, local);
  return { nodes, ...mergeTinyGaps(nodes, edges), centre, radius: radiusM };
}

/**
 * One junction is sometimes drawn as two or three points a metre apart, with
 * tiny road pieces between them; turning there would land on a piece with no
 * real direction. Merge points joined by a piece shorter than 1.5 m.
 */
function mergeTinyGaps(nodes: RoadNode[], edges: RoadEdge[]): { edges: RoadEdge[] } {
  const parent = nodes.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const e of edges) if (e.length < 1.5) parent[root(e.b)] = root(e.a);

  const kept: RoadEdge[] = [];
  const byPair = new Map<string, number>();
  for (const e of edges) {
    const a = root(e.a);
    const b = root(e.b);
    if (a === b) continue; // the tiny piece itself
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const same = byPair.get(key);
    if (same !== undefined) {
      if (e.length < kept[same].length) kept[same] = { ...e, a, b }; // two pieces now join the same points: keep one
      continue;
    }
    byPair.set(key, kept.length);
    kept.push({ ...e, a, b });
  }
  for (const n of nodes) n.edges = [];
  kept.forEach((e, id) => {
    nodes[e.a].edges.push(id);
    nodes[e.b].edges.push(id);
  });
  return { edges: kept };
}

/**
 * Map tiles simplify road shapes, which can drop the point two roads share at
 * a crossroads: the roads then cross without meeting. Put a junction wherever
 * two roads at the same level cross (a bridge over a road doesn't count).
 */
function joinCrossings(nodes: RoadNode[], edges: RoadEdge[], local: (p: { lng: number; lat: number }) => { x: number; y: number }) {
  const CELL_M = 25;
  const SNAP_M = 0.5; // a crossing this close to a road's existing point uses that point
  const xy = nodes.map((n) => local(n));
  const grid = new Map<string, number[]>();
  edges.forEach((e, id) => {
    const a = xy[e.a];
    const b = xy[e.b];
    for (let cx = Math.floor(Math.min(a.x, b.x) / CELL_M); cx <= Math.floor(Math.max(a.x, b.x) / CELL_M); cx++) {
      for (let cy = Math.floor(Math.min(a.y, b.y) / CELL_M); cy <= Math.floor(Math.max(a.y, b.y) / CELL_M); cy++) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(id);
        else grid.set(key, [id]);
      }
    }
  });

  // Where each road piece gets cut: how far along it (0–1) and by which node.
  const cuts = new Map<number, { t: number; node: number }[]>();
  const addCut = (edge: number, t: number, node: number) => {
    const e = edges[edge];
    if (node === e.a || node === e.b) return;
    const list = cuts.get(edge);
    if (list) list.push({ t, node });
    else cuts.set(edge, [{ t, node }]);
  };
  const checked = new Set<string>();
  for (const bucket of grid.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [m, n] = bucket[i] < bucket[j] ? [bucket[i], bucket[j]] : [bucket[j], bucket[i]];
        const key = `${m}-${n}`;
        if (checked.has(key)) continue;
        checked.add(key);
        const e1 = edges[m];
        const e2 = edges[n];
        if (e1.level !== e2.level) continue;
        if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue; // already meet
        const p = xy[e1.a];
        const r = { x: xy[e1.b].x - p.x, y: xy[e1.b].y - p.y };
        const q = xy[e2.a];
        const sv = { x: xy[e2.b].x - q.x, y: xy[e2.b].y - q.y };
        const d = r.x * sv.y - r.y * sv.x;
        if (Math.abs(d) < 1e-9) continue; // parallel
        const t = ((q.x - p.x) * sv.y - (q.y - p.y) * sv.x) / d;
        const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / d;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        // Use an existing end point if the crossing is right at it; otherwise a new junction.
        let node: number;
        if (t * e1.length < SNAP_M) node = e1.a;
        else if ((1 - t) * e1.length < SNAP_M) node = e1.b;
        else if (u * e2.length < SNAP_M) node = e2.a;
        else if ((1 - u) * e2.length < SNAP_M) node = e2.b;
        else {
          node = nodes.length;
          const a = nodes[e1.a];
          const b = nodes[e1.b];
          nodes.push({ lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t, edges: [] });
          xy.push(local(nodes[node]));
        }
        addCut(m, t, node);
        addCut(n, u, node);
      }
    }
  }
  if (!cuts.size) return;

  // Cut the crossing pieces into shorter ones that meet at the new junctions.
  for (const [id, list] of cuts) {
    const e = edges[id];
    list.sort((x, y) => x.t - y.t);
    const chain = [e.a, ...list.map((c) => c.node).filter((v, k, all) => v !== all[k - 1]), e.b];
    const piece = (from: number, to: number) => Math.max(0.01, Math.hypot(xy[to].x - xy[from].x, xy[to].y - xy[from].y));
    e.b = chain[1];
    e.length = piece(chain[0], chain[1]);
    for (let k = 1; k < chain.length - 1; k++) edges.push({ a: chain[k], b: chain[k + 1], length: piece(chain[k], chain[k + 1]), level: e.level, closed: e.closed });
  }
  for (const n of nodes) n.edges = [];
  edges.forEach((e, id) => {
    nodes[e.a].edges.push(id);
    nodes[e.b].edges.push(id);
  });
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
      edges.push({ a: target, b: oldB, length: e.length * (1 - bestT), level: e.level, closed: e.closed });
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
/**
 * Road pieces cut off from the rest: a small group of roads joined to nothing
 * else, lying wholly inside the loaded area (so it isn't just cut by its edge),
 * such as an airfield's paths or a fenced car park. A hunter put there could
 * only walk in circles. 1 marks such an edge; 2 a group of roads behind a
 * fence, however big: no public road in it at all, or (not the town's own,
 * largest group) mostly roads with no public access. An airport's airside is
 * joined to the town only by motorways a walker can't use (owner, 27 Oct 2026,
 * landed at San Francisco "on a road that leads nowhere").
 */
const pocketsOf = new WeakMap<RoadNetwork, Uint8Array>();
export function cutOffEdges(net: RoadNetwork): Uint8Array {
  const known = pocketsOf.get(net);
  if (known) return known;
  const parent = net.nodes.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (const e of net.edges) parent[root(e.a)] = root(e.b);
  const length = new Map<number, number>();
  const inside = new Map<number, boolean>();
  const closed = new Map<number, number>(); // how much of each group has no public access
  const local = projector(net.centre);
  const margin = net.radius - 100;
  for (const e of net.edges) {
    const r = root(e.a);
    length.set(r, (length.get(r) ?? 0) + e.length);
    if (e.closed) closed.set(r, (closed.get(r) ?? 0) + e.length);
    if (inside.get(r) === false) continue;
    const p = local(net.nodes[e.a]);
    const q = local(net.nodes[e.b]);
    inside.set(r, Math.hypot(p.x, p.y) < margin && Math.hypot(q.x, q.y) < margin);
  }
  const largest = Math.max(0, ...length.values());
  const fenced = (r: number) => {
    const all = length.get(r) ?? 0;
    const shut = closed.get(r) ?? 0;
    return shut >= all || (all < largest && shut >= all / 2);
  };
  const flags = new Uint8Array(net.edges.length);
  net.edges.forEach((e, i) => {
    const r = root(e.a);
    if (fenced(r)) flags[i] = 2;
    else if (largest > 3000 && inside.get(r) && (length.get(r) ?? 0) < largest * 0.1) flags[i] = 1;
  });
  pocketsOf.set(net, flags);
  return flags;
}

/** The nearest road to a point (`skip`: edges not to use, e.g. cut-off pockets). */
export function snapToNetwork(net: RoadNetwork, pos: LngLat, heading: number, skip?: Uint8Array): RoadPosition | null {
  const local = projector(pos);
  let edge = -1;
  let t = 0;
  let nearest = Infinity;
  for (let i = 0; i < net.edges.length; i++) {
    if (skip?.[i]) continue;
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
  const oneway = net.edges[edge].oneway;
  const dir: 1 | -1 = oneway ?? (angleBetween(edgeHeading(net, edge, 1), heading) <= Math.PI / 2 ? 1 : -1);
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
  // Roads ahead (within 60° of straight on), for forks.
  const ahead: { id: number; dir: 1 | -1; side: number }[] = [];
  for (const id of net.nodes[node].edges) {
    const d: 1 | -1 = net.edges[id].a === node ? 1 : -1;
    if (!canGo(net.edges[id], d)) continue; // a one-way street the wrong way
    const h = headingAway(net, node, id);
    // Turning left raises the scene heading, turning right lowers it (see geo.headingOf).
    const side = -turn * Math.atan2(Math.sin(h - straight), Math.cos(h - straight));
    if (Math.abs(side) < (60 * Math.PI) / 180) ahead.push({ id, dir: d, side });
    if (side < SIDE_MIN || side > SIDE_MAX) continue;
    const score = Math.abs(side - Math.PI / 2);
    if (!best || score < best.score) best = { id, dir: d, score };
  }
  if (best) return best;
  // A fork: the road splits into branches that all go roughly ahead (e.g. both
  // 10–20° to one side). Left takes the leftmost, right the rightmost, as long
  // as it is clearly more that way than the other branch.
  if (ahead.length >= 2) {
    ahead.sort((x, y) => y.side - x.side);
    if (ahead[0].side - ahead[1].side > (5 * Math.PI) / 180) return { id: ahead[0].id, dir: ahead[0].dir, score: 0 };
  }
  return null;
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
    const options = net.nodes[node].edges.filter((id) => id !== edge && canGo(net.edges[id], net.edges[id].a === node ? 1 : -1));
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

/**
 * The shortest way along the roads from where the player is to the nearest
 * point to `to` that the roads can reach, as a line of [lng, lat] points
 * (starting at the player), or null if no loaded road comes within `withinM`
 * of `to` or none of those can be reached. The very nearest road may be cut
 * off (an airport's airside paths, a gated estate), so the goal is the nearest
 * one that can be reached. Used for "Go to a place" trips, so they follow
 * exactly the roads the hunter travels on.
 */
export function findPath(net: RoadNetwork, from: RoadPosition, to: LngLat, withinM = 60): Coord[] | null {
  const local = projector(to);
  const nearest = snapToNetwork(net, to, 0);
  if (!nearest) return null;
  const off = local(positionOf(net, nearest));
  if (Math.hypot(off.x, off.y) > withinM) return null; // only part of the map is loaded: no road really near `to`
  const start = positionOf(net, from);
  const fromEdge = net.edges[from.edge];

  // Dijkstra from both ends of the player's road piece.
  const dist = new Float64Array(net.nodes.length).fill(Infinity);
  const prev = new Int32Array(net.nodes.length).fill(-1);
  const heap: [number, number][] = [];
  const push = (d: number, node: number) => {
    heap.push([d, node]);
    for (let i = heap.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const relax = (node: number, d: number, from: number) => {
    if (d < dist[node]) {
      dist[node] = d;
      prev[node] = from;
      push(d, node);
    }
  };
  if (canGo(fromEdge, -1)) relax(fromEdge.a, from.t * fromEdge.length, -1);
  if (canGo(fromEdge, 1)) relax(fromEdge.b, (1 - from.t) * fromEdge.length, -1);
  while (heap.length) {
    const [d, node] = pop();
    if (d > dist[node]) continue;
    for (const id of net.nodes[node].edges) {
      const e = net.edges[id];
      if (canGo(e, e.a === node ? 1 : -1)) relax(e.a === node ? e.b : e.a, d + e.length, node);
    }
  }

  // The goal: the reachable road point nearest `to`, arriving along its piece from the closer end.
  let goal: { edge: number; t: number; d: number; direct: boolean; viaNode: number } | null = null;
  for (let i = 0; i < net.edges.length; i++) {
    const e = net.edges[i];
    const a = local(net.nodes[e.a]);
    const b = local(net.nodes[e.b]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    const d = Math.hypot(a.x + dx * t, a.y + dy * t);
    if (d > withinM || (goal && d >= goal.d)) continue;
    if (i === from.edge && canGo(e, t >= from.t ? 1 : -1)) {
      goal = { edge: i, t, d, direct: true, viaNode: -1 };
      continue;
    }
    const viaA = canGo(e, 1) ? dist[e.a] + t * e.length : Infinity;
    const viaB = canGo(e, -1) ? dist[e.b] + (1 - t) * e.length : Infinity;
    if (!Number.isFinite(Math.min(viaA, viaB))) continue; // cut off from the player
    goal = { edge: i, t, d, direct: false, viaNode: viaA <= viaB ? e.a : e.b };
  }
  if (!goal) return null;
  const end = positionOf(net, { edge: goal.edge, t: goal.t, dir: 1 });
  if (goal.direct) return [[start.lng, start.lat], [end.lng, end.lat]];
  const path: Coord[] = [];
  for (let node = goal.viaNode; node !== -1; node = prev[node]) path.push([net.nodes[node].lng, net.nodes[node].lat]);
  path.reverse();
  return [[start.lng, start.lat], ...path, [end.lng, end.lat]];
}

const OSM_FOOT_ONLY = new Set<RoadClass>(["pedestrian", "footway", "path", "steps", "cycleway", "bridleway"]);

/** Which of our own roads a travel mode may use (see allowed() for the tile version). */
function allowedRoad(mode: Mode, cls: RoadClass, flags: number) {
  if (mode === "motorbike" || mode === "car") return !OSM_FOOT_ONLY.has(cls) && !(flags & ROAD_FLAGS.private);
  if (cls === "motorway" || cls === "motorway_link") return false;
  if (mode === "bicycle" && cls === "steps") return false;
  return true;
}

/**
 * Build the road graph from our own road squares (src/game/roadData.ts).
 * Roads that meet share a point id, so junctions are exact: none of the
 * guesswork the drawing tiles need. Squares overlap by one segment at their
 * edges; the shared point ids join them up.
 */
export function buildNetworkFromCells(cells: RoadCellData[], mode: Mode, centre: LngLat, radiusM = 1500): RoadNetwork {
  const local = projector(centre);
  const nodes: RoadNode[] = [];
  const edges: RoadEdge[] = [];
  const coords = new Map<number, { lng: number; lat: number }>();
  for (const cell of cells) for (const p of cell.points) coords.set(p.id, p);
  const byId = new Map<number, number>();
  const nodeFor = (id: number) => {
    let i = byId.get(id);
    if (i === undefined) {
      const p = coords.get(id)!;
      i = nodes.length;
      nodes.push({ lng: p.lng, lat: p.lat, edges: [] });
      byId.set(id, i);
    }
    return i;
  };
  const seen = new Set<string>();
  for (const cell of cells) {
    const urban = cellUrban(cell);
    for (const way of cell.ways) {
      if (!allowedRoad(mode, way.cls, way.flags)) continue;
      const level = way.flags & ROAD_FLAGS.bridge ? 1 : way.flags & ROAD_FLAGS.tunnel ? -1 : 0;
      const motor = mode === "motorbike" || mode === "car";
      const oneway: 1 | -1 | undefined = !motor
        ? undefined
        : way.flags & ROAD_FLAGS.oneway
          ? 1
          : way.flags & ROAD_FLAGS.onewayBackwards
            ? -1
            : undefined;
      for (let i = 1; i < way.points.length; i++) {
        const pa = coords.get(way.points[i - 1]);
        const pb = coords.get(way.points[i]);
        if (!pa || !pb) continue;
        const p = local(pa);
        const q = local(pb);
        if (reachOf(p, q) > radiusM) continue;
        const a = nodeFor(way.points[i - 1]);
        const b = nodeFor(way.points[i]);
        if (a === b) continue;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue; // the same segment from two neighbouring squares
        seen.add(key);
        const id = edges.length;
        // a and b are in the road's own order, so its one-way direction maps straight across.
        edges.push({
          a,
          b,
          length: Math.max(0.01, Math.hypot(q.x - p.x, q.y - p.y)),
          level,
          name: way.name,
          oneway,
          cls: way.cls,
          stretch: jamStretch(way, pa),
          urban,
          ...(way.flags & ROAD_FLAGS.private && { closed: true }),
        });
        nodes[a].edges.push(id);
        nodes[b].edges.push(id);
      }
    }
  }
  return { nodes, edges, centre, radius: radiusM };
}

/** The road the player is on, for traffic: its kind, stretch and how built-up the area is (our own roads only). */
export function roadHere(net: RoadNetwork, rp: RoadPosition) {
  const e = net.edges[rp.edge];
  return e?.cls !== undefined ? { cls: e.cls, stretch: e.stretch ?? 0, urban: e.urban ?? 0 } : null;
}

/**
 * The roads (our own, with traffic) within `withinM` of a point: what the map draws there. A car sits in the
 * whole width of a jam drawn on the map, slip roads and short unnamed pieces included (owner, 18 Oct 2026: a car
 * on an unnamed slip road inside Western Avenue's go-slow sped off while the map was still red), so the traffic
 * that holds it is the worst on any road this near, not just the one piece it's on.
 */
export function roadsNear(net: RoadNetwork, pos: LngLat, withinM: number) {
  const local = projector(pos);
  const found: { cls: RoadClass; stretch: number; urban: number }[] = [];
  for (const e of net.edges) {
    if (e.cls === undefined) continue;
    const a = local(net.nodes[e.a]);
    const b = local(net.nodes[e.b]);
    if (Math.min(a.x, b.x) > withinM || Math.max(a.x, b.x) < -withinM || Math.min(a.y, b.y) > withinM || Math.max(a.y, b.y) < -withinM) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const f = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1e-9)));
    if (Math.hypot(a.x + dx * f, a.y + dy * f) <= withinM) found.push({ cls: e.cls, stretch: e.stretch ?? 0, urban: e.urban ?? 0 });
  }
  return found;
}

const STREETS = new Set<RoadClass>(["residential", "living_street", "unclassified", "tertiary"]);
const MAIN_ROADS = new Set<RoadClass>([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
]);

/**
 * A spot on an ordinary street near `pos` (a residential street, an unclassified or tertiary road, at ground
 * level), at least `clearM` from any main road, so a bike renter waits in a side street, not by a highway
 * (owner, 18 Oct 2026). The nearest such spot within `maxM`; a named street wins if it's no more than 80 m
 * further. Null when there's none (or the roads came from the map tiles, which don't know road kinds).
 */
export function streetSpot(net: RoadNetwork, pos: LngLat, maxM = 600, clearM = 35): (LngLat & { name: string | null; metres: number }) | null {
  const local = projector(pos);
  const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
  const main: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (const e of net.edges) {
    if (!e.cls || !MAIN_ROADS.has(e.cls)) continue;
    const a = local(net.nodes[e.a]);
    const b = local(net.nodes[e.b]);
    if (Math.min(Math.hypot(a.x, a.y), Math.hypot(b.x, b.y)) < maxM + clearM + 200) main.push({ a, b });
  }
  const offMain = (p: { x: number; y: number }) =>
    main.every(({ a, b }) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-9)));
      return Math.hypot(a.x + dx * f - p.x, a.y + dy * f - p.y) >= clearM;
    });
  let best: { x: number; y: number; name: string | null; metres: number; score: number } | null = null;
  for (const e of net.edges) {
    if (!e.cls || !STREETS.has(e.cls) || e.level !== 0) continue;
    const a = local(net.nodes[e.a]);
    const b = local(net.nodes[e.b]);
    if (Math.min(Math.hypot(a.x, a.y), Math.hypot(b.x, b.y)) > maxM + e.length) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // The nearest point of the piece, and its middle: the first one clear of main roads.
    const f = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1e-9)));
    for (const t of [f, 0.5]) {
      const p = { x: a.x + dx * t, y: a.y + dy * t };
      const metres = Math.hypot(p.x, p.y);
      if (metres > maxM || !offMain(p)) continue;
      const score = metres + (e.name ? 0 : 80);
      if (!best || score < best.score) best = { ...p, name: e.name ?? null, metres, score };
      break;
    }
  }
  return best ? { lng: pos.lng + best.x / kx, lat: pos.lat + best.y / 110574, name: best.name, metres: best.metres } : null;
}

/** The street name of the road the player is on, if the network knows names (our own roads do). */
export function streetName(net: RoadNetwork, rp: RoadPosition): string | null | undefined {
  return net.edges[rp.edge]?.name;
}

/**
 * Forks along a path found on this network: places where the road splits into
 * branches that all go roughly ahead, so the way on is "keep left" or "keep
 * right" rather than a turn. `index` is the point in `path`; `side` −1 left, +1 right.
 */
export function findForks(net: RoadNetwork, path: Coord[]): { index: number; side: -1 | 1 }[] {
  const key = (lng: number, lat: number) => `${lng.toFixed(7)},${lat.toFixed(7)}`;
  const junctions = new Map<string, number>();
  net.nodes.forEach((n, i) => {
    if (n.edges.length >= 3) junctions.set(key(n.lng, n.lat), i);
  });
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const headingBetween = (a: Coord, b: Coord) => Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), -(b[1] - a[1]));
  // A point ~10 m before or after path[i], so tiny kinks don't decide the direction.
  const reach = (i: number, step: -1 | 1) => {
    let j = i;
    let gone = 0;
    while (j + step >= 0 && j + step < path.length && gone < 10) {
      const a = path[j];
      const b = path[j + step];
      gone += Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110574);
      j += step;
    }
    return path[j];
  };
  const forks: { index: number; side: -1 | 1 }[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const node = junctions.get(key(path[i][0], path[i][1]));
    if (node === undefined) continue;
    const arrive = headingBetween(reach(i, -1), path[i]);
    const leave = wrap(headingBetween(path[i], reach(i, 1)) - arrive);
    if (Math.abs(leave) >= (35 * Math.PI) / 180) continue; // a real turn: announced as one already
    const ahead = net.nodes[node].edges.map((id) => wrap(headingAway(net, node, id) - arrive)).filter((a) => Math.abs(a) < (60 * Math.PI) / 180);
    if (ahead.length < 2) continue;
    const others = ahead.filter((a) => Math.abs(a - leave) > (3 * Math.PI) / 180);
    if (!others.length) continue;
    // Positive angles are to the left (see geo.headingOf).
    if (others.every((a) => leave > a + (5 * Math.PI) / 180)) forks.push({ index: i, side: -1 });
    else if (others.every((a) => leave < a - (5 * Math.PI) / 180)) forks.push({ index: i, side: 1 });
  }
  return forks;
}
