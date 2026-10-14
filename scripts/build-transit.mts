/**
 * Builds the public transport data (design doc 5.5) from an OpenStreetMap
 * extract: bus stops and motor parks, train lines with their stations in
 * order, and airports.
 *
 *   node --max-old-space-size=4096 scripts/build-transit.mts <extract.osm.pbf> <out.json>
 *
 * Use the same Geofabrik Nigeria extract as the roads (scripts/build-roads.mts),
 * then load the result with `npm run transit:upload -- <out.json>`.
 *
 * Three passes over the file (nodes come before ways, ways before relations):
 *  1. relations: the train lines' member ways and stops, and airport outlines;
 *  2. ways: railway track, motor parks, airports and terminals (and every way
 *     those relations named), plus tagged nodes (stops, stations, airports);
 *  3. nodes: the points those ways use.
 */
import { createReadStream, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const parse = require("osm-pbf-parser") as () => NodeJS.ReadWriteStream;

type Tags = Record<string, string>;
type OsmItem =
  | { type: "node"; id: number; lat: number; lon: number; tags?: Tags }
  | { type: "way"; id: number; tags: Tags; refs: number[] }
  | { type: "relation"; id: number; tags: Tags; members: { type: string; id: number; role: string }[] };
type Pt = [number, number]; // [lng, lat]

/**
 * The train lines in the game. `relation` is the OpenStreetMap route to take
 * the track and stops from; the Lagos Red Line has none yet, so it follows the
 * track between its stations. `nearStations` adds stations lying along the
 * track that the route doesn't list.
 */
const LINES: {
  id: string;
  name: string;
  colour: string;
  relation?: number;
  stations?: string[];
  /**
   * Named stations at known positions, joined along the nearest track; where the
   * map's track has a gap between two of them, a straight stretch bridges it.
   */
  waypoints?: { name: string; lng: number; lat: number }[];
  nearStations?: boolean;
  /** Stations near the track that belong to another line (e.g. the metro running alongside). */
  notStations?: string[];
}[] = [
  { id: "lagos-ibadan", name: "Lagos–Ibadan Express", colour: "#1E9E62", relation: 13184642 },
  { id: "lagos-red", name: "Lagos Red Line", colour: "#D62828", stations: ["Agbado", "Iju", "Agege", "Ikeja", "Oshodi", "Mushin", "Yaba", "Mobolaji Johnson Station", "Oyingbo"] },
  { id: "lagos-blue", name: "Lagos Blue Line", colour: "#2F6FEB", relation: 15668733 },
  { id: "abuja-kaduna", name: "Abuja–Kaduna Train", colour: "#1E9E62", relation: 6441947, nearStations: true, notStations: ["Gbazango", "Kagini", "Deidei", "Gwagwa"] },
  { id: "abuja-yellow", name: "Abuja Metro Yellow Line", colour: "#F4B41A", relation: 8441841 },
  { id: "abuja-blue", name: "Abuja Metro Blue Line", colour: "#2F6FEB", relation: 8442723 },
  { id: "warri-itakpe", name: "Warri–Itakpe Train", colour: "#1E9E62", relation: 9285998 },
  // The old western line, Lagos to Kano (the Nigerian Railway Corporation's long-distance train); no complete route in the map.
  {
    id: "lagos-kano",
    name: "Lagos–Kano Train",
    colour: "#B8643C",
    waypoints: [
      { name: "Lagos (Ebute Metta)", lng: 3.381, lat: 6.483 },
      { name: "Agege", lng: 3.326, lat: 6.619 },
      { name: "Ibadan", lng: 3.915, lat: 7.432 },
      { name: "Iwo", lng: 4.205, lat: 7.557 },
      { name: "Ede", lng: 4.433, lat: 7.75 },
      { name: "Osogbo", lng: 4.548, lat: 7.78 },
      { name: "Offa", lng: 4.727, lat: 8.155 },
      { name: "Ilorin", lng: 4.5612, lat: 8.4945 },
      { name: "Jebba", lng: 4.825, lat: 9.129 },
      { name: "Minna", lng: 6.549, lat: 9.614 },
      { name: "Kaduna Junction", lng: 7.416, lat: 10.492 },
      { name: "Kaduna North", lng: 7.426, lat: 10.541 },
      { name: "Zaria", lng: 7.724, lat: 11.11 },
      { name: "Kano", lng: 8.539, lat: 11.999 },
    ],
  },
  // The Port Harcourt–Kano route; its track is only complete in the map from Kaduna to Kano (the longest unbroken run is used).
  { id: "kaduna-kano", name: "Kaduna–Kano Train", colour: "#7A5A44", relation: 8527053, nearStations: true },
];

/** Stations the map has no name for. */
const NAME_FIXES: { lng: number; lat: number; name: string }[] = [{ lng: 3.2312, lat: 6.8147, name: "Kajola" }];

/** Airports with scheduled flights (the extract also lists a flight school, an air force base and an unused airstrip). */
const NOT_AIRPORTS = new Set(["ZAR", "PHG", "QUS"]);
/** Codes the map has wrong. */
const CODE_FIXES: Record<string, string> = { "Chinua Achebe International Airport": "ANA" };

const RAIL = new Set(["rail", "light_rail", "subway", "narrow_gauge"]);

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/build-transit.mts <extract.osm.pbf> <out.json>");
  process.exit(1);
}
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;

function readAll(onItem: (item: OsmItem) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(input)
      .pipe(parse())
      .on("data", (items: OsmItem[]) => items.forEach(onItem))
      .on("end", resolve)
      .on("error", reject);
  });
}

function distanceM(a: Pt, b: Pt) {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

// ---- Pass 1: relations ------------------------------------------------------
const lineRelations = new Map<number, { ways: number[]; stops: number[] }>();
const airportRelations: { tags: Tags; ways: number[] }[] = [];
const wantedWays = new Set<number>();
const wantedRelations = new Set(LINES.flatMap((l) => (l.relation ? [l.relation] : [])));
await readAll((it) => {
  if (it.type !== "relation") return;
  if (wantedRelations.has(it.id)) {
    const ways = it.members.filter((m) => m.type === "way" && (m.role === "" || m.role === "route")).map((m) => m.id);
    const stops = it.members.filter((m) => m.type === "node" && /stop|platform/.test(m.role)).map((m) => m.id);
    lineRelations.set(it.id, { ways, stops });
    ways.forEach((w) => wantedWays.add(w));
  } else if (it.tags.aeroway === "aerodrome" && it.tags.iata) {
    const ways = it.members.filter((m) => m.type === "way" && m.role !== "inner").map((m) => m.id);
    airportRelations.push({ tags: it.tags, ways });
    ways.forEach((w) => wantedWays.add(w));
  }
});
console.log(`pass 1 (relations) done in ${elapsed()}: ${lineRelations.size} lines, ${airportRelations.length} airport outlines`);

// ---- Pass 2: ways, and tagged nodes ----------------------------------------
type Tagged = { id: number; pt: Pt; tags: Tags };
const stopNodes = new Map<number, Tagged>(); // anything a line or bus could stop at
const busStops: Tagged[] = [];
const stations: Tagged[] = [];
const airportNodes: Tagged[] = [];
const terminalNodes: Tagged[] = [];
const railWays = new Map<number, number[]>();
const memberWays = new Map<number, number[]>();
const areaWays: { kind: "park" | "airport" | "terminal"; tags: Tags; refs: number[] }[] = [];
const needNodes = new Set<number>();
const lineStopIds = new Set([...lineRelations.values()].flatMap((r) => r.stops));

await readAll((it) => {
  if (it.type === "node") {
    const t = it.tags ?? {};
    const pt: Pt = [it.lon, it.lat];
    const tagged = { id: it.id, pt, tags: t };
    if (lineStopIds.has(it.id)) stopNodes.set(it.id, tagged);
    if (t.highway === "bus_stop" || ((t.public_transport === "platform" || t.public_transport === "stop_position") && t.bus === "yes")) busStops.push(tagged);
    if (t.amenity === "bus_station") busStops.push({ ...tagged, tags: { ...t, park: "yes" } });
    if (t.railway === "station" || t.railway === "halt" || t.railway === "stop") stations.push(tagged);
    if (t.aeroway === "aerodrome" && t.iata) airportNodes.push(tagged);
    if (t.aeroway === "terminal") terminalNodes.push(tagged);
    return;
  }
  if (it.type !== "way") return;
  const t = it.tags;
  let keep = false;
  if (t.railway && RAIL.has(t.railway)) {
    railWays.set(it.id, it.refs);
    keep = true;
  }
  if (wantedWays.has(it.id)) {
    memberWays.set(it.id, it.refs);
    keep = true;
  }
  if (t.amenity === "bus_station") areaWays.push({ kind: "park", tags: t, refs: it.refs });
  else if (t.aeroway === "aerodrome" && t.iata) areaWays.push({ kind: "airport", tags: t, refs: it.refs });
  else if (t.aeroway === "terminal") areaWays.push({ kind: "terminal", tags: t, refs: it.refs });
  else if (!keep) return;
  it.refs.forEach((r) => needNodes.add(r));
});
console.log(`pass 2 (ways) done in ${elapsed()}: ${railWays.size} railway ways, ${busStops.length} bus stop points, ${stations.length} station points`);

// ---- Pass 3: node positions -------------------------------------------------
const coords = new Map<number, Pt>();
await readAll((it) => {
  if (it.type === "node" && needNodes.has(it.id)) coords.set(it.id, [it.lon, it.lat]);
});
console.log(`pass 3 (points) done in ${elapsed()}: ${coords.size} points`);

const centroid = (refs: number[]): Pt | null => {
  const pts = refs.map((r) => coords.get(r)).filter((p): p is Pt => !!p);
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
};

// ---- Track graphs and line shapes -------------------------------------------
type Graph = Map<number, { to: number; m: number }[]>;
function graphOf(ways: Iterable<number[]>): Graph {
  const g: Graph = new Map();
  for (const refs of ways) {
    for (let i = 1; i < refs.length; i++) {
      const a = coords.get(refs[i - 1]);
      const b = coords.get(refs[i]);
      if (!a || !b) continue;
      const m = distanceM(a, b);
      if (!g.has(refs[i - 1])) g.set(refs[i - 1], []);
      if (!g.has(refs[i])) g.set(refs[i], []);
      g.get(refs[i - 1])!.push({ to: refs[i], m });
      g.get(refs[i])!.push({ to: refs[i - 1], m });
    }
  }
  return g;
}

/** Shortest distances from `from` (and the way back), over the whole graph. */
function dijkstra(g: Graph, from: number, to?: number) {
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  // A simple binary heap of [distance, node].
  const heap: [number, number][] = [[0, from]];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const end = heap.pop()!;
    if (heap.length) {
      heap[0] = end;
      let i = 0;
      for (;;) {
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
  while (heap.length) {
    const [d, n] = pop();
    if (done.has(n)) continue;
    done.add(n);
    if (n === to) break;
    for (const e of g.get(n) ?? []) {
      const nd = d + e.m;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, n);
        push([nd, e.to]);
      }
    }
  }
  return { dist, prev };
}

function pathTo(prev: Map<number, number>, from: number, to: number): number[] | null {
  const out = [to];
  let n = to;
  while (n !== from) {
    const p = prev.get(n);
    if (p === undefined) return null;
    out.push(p);
    n = p;
  }
  return out.reverse();
}

function nearestNode(g: Graph, pt: Pt, withinM: number): number | null {
  let best: number | null = null;
  let bestM = withinM;
  for (const n of g.keys()) {
    const p = coords.get(n)!;
    const m = distanceM(p, pt);
    if (m < bestM) {
      bestM = m;
      best = n;
    }
  }
  return best;
}

/** Join the pieces of a route's track that don't touch (gaps in the map) to the nearest piece, up to 3 km. */
function joinPieces(g: Graph) {
  for (;;) {
    const pieces: Set<number>[] = [];
    const seen = new Set<number>();
    for (const n of g.keys()) {
      if (seen.has(n)) continue;
      const piece = new Set<number>([n]);
      const queue = [n];
      seen.add(n);
      while (queue.length) {
        const x = queue.pop()!;
        for (const e of g.get(x)!) {
          if (seen.has(e.to)) continue;
          seen.add(e.to);
          piece.add(e.to);
          queue.push(e.to);
        }
      }
      pieces.push(piece);
    }
    if (pieces.length < 2) return;
    pieces.sort((a, b) => b.size - a.size);
    const main = pieces[0];
    let best: { a: number; b: number; m: number } | null = null;
    for (const piece of pieces.slice(1)) {
      for (const a of piece) {
        const pa = coords.get(a)!;
        for (const b of main) {
          const m = distanceM(pa, coords.get(b)!);
          if (!best || m < best.m) best = { a, b, m };
        }
      }
    }
    if (!best || best.m > 3000) return;
    g.get(best.a)!.push({ to: best.b, m: best.m });
    g.get(best.b)!.push({ to: best.a, m: best.m });
  }
}

/** The longest stretch of track in a graph: from any point to the farthest, then to the farthest from there. */
function longestRun(g: Graph): number[] | null {
  const first = g.keys().next().value;
  if (first === undefined) return null;
  const far = (from: number) => {
    const { dist } = dijkstra(g, from);
    let end = from;
    for (const [n, d] of dist) if (d > dist.get(end)!) end = n;
    return end;
  };
  const a = far(first);
  const b = far(a);
  const { prev } = dijkstra(g, a, b);
  return pathTo(prev, a, b);
}

/** Drop points that barely change the line's shape (within `tolM` metres). */
function simplify(points: Pt[], tolM: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const lat0 = (points[0][1] * Math.PI) / 180;
  const xy = points.map(([lng, lat]) => [lng * 111320 * Math.cos(lat0), lat * 110574]);
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = xy[i];
    const [bx, by] = xy[j];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let worstM = tolM;
    for (let k = i + 1; k < j; k++) {
      const m = Math.abs((bx - ax) * (ay - xy[k][1]) - (ax - xy[k][0]) * (by - ay)) / len;
      if (m > worstM) {
        worstM = m;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** Where a point lies along a line: metres from the start, and how far off the line it is. */
function project(path: Pt[], pt: Pt) {
  let best = { along: 0, off: Infinity };
  let run = 0;
  const lat0 = (pt[1] * Math.PI) / 180;
  const kx = 111320 * Math.cos(lat0);
  const ky = 110574;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = [path[i - 1][0] * kx, path[i - 1][1] * ky];
    const [bx, by] = [path[i][0] * kx, path[i][1] * ky];
    const [px, py] = [pt[0] * kx, pt[1] * ky];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const f = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
    const off = Math.hypot(ax + f * (bx - ax) - px, ay + f * (by - ay) - py);
    const seg = distanceM(path[i - 1], path[i]);
    if (off < best.off) best = { along: run + f * seg, off };
    run += seg;
  }
  return best;
}

const allRail = graphOf(railWays.values());
const namedStation = (pt: Pt, withinM: number) => {
  let best: Tagged | null = null;
  for (const s of stations) {
    if (!s.tags.name) continue;
    if (distanceM(s.pt, pt) < withinM && (!best || distanceM(s.pt, pt) < distanceM(best.pt, pt))) best = s;
  }
  return best;
};
const stationName = (s: Tagged) =>
  NAME_FIXES.find((f) => distanceM([f.lng, f.lat], s.pt) < 500)?.name ?? s.tags.name ?? namedStation(s.pt, 1500)?.tags.name ?? null;

type Line = { id: string; name: string; colour: string; path: Pt[]; length_m: number; stops: { name: string; lng: number; lat: number; along_m: number }[] };
const lines: Line[] = [];
for (const spec of LINES) {
  let nodes: number[] | null = null;
  let candidates: Tagged[] = [];
  if (spec.relation) {
    const rel = lineRelations.get(spec.relation);
    if (!rel) {
      console.warn(`! ${spec.name}: relation ${spec.relation} not in the extract; skipped`);
      continue;
    }
    const g = graphOf(rel.ways.map((w) => memberWays.get(w) ?? []));
    joinPieces(g);
    nodes = longestRun(g);
    candidates = rel.stops.map((id) => stopNodes.get(id)).filter((s): s is Tagged => !!s);
  } else if (spec.stations) {
    // Follow the track from station to station.
    const points = spec.stations.map((name) => stations.find((s) => s.tags.name === name));
    if (points.some((p) => !p)) {
      console.warn(`! ${spec.name}: a station is missing; skipped`);
      continue;
    }
    nodes = [];
    for (let i = 1; i < points.length; i++) {
      const a = nearestNode(allRail, points[i - 1]!.pt, 800);
      const b = nearestNode(allRail, points[i]!.pt, 800);
      const leg = a !== null && b !== null ? pathTo(dijkstra(allRail, a, b).prev, a, b) : null;
      if (!leg) {
        nodes = null;
        break;
      }
      nodes.push(...(nodes.length ? leg.slice(1) : leg));
    }
    candidates = points as Tagged[];
  }
  let full: Pt[] | null = nodes && nodes.length >= 2 ? nodes.map((n) => coords.get(n)!) : null;
  if (spec.waypoints) {
    // Station to station along the track (within 5 km of each), straight across any gap.
    full = [];
    const bridged: string[] = [];
    const ends = spec.waypoints.map((w) => nearestNode(allRail, [w.lng, w.lat], 5000));
    for (let i = 1; i < spec.waypoints.length; i++) {
      const [a, b] = [ends[i - 1], ends[i]];
      const leg = a !== null && b !== null ? pathTo(dijkstra(allRail, a, b).prev, a, b) : null;
      let pts: Pt[];
      if (leg) pts = leg.map((n) => coords.get(n)!);
      else if (a !== null && b !== null) {
        // The track is broken somewhere between them: follow it from each end as far as it
        // goes towards the other, and bridge only what's left.
        const fromA = dijkstra(allRail, a);
        const target = coords.get(b)!;
        let x = a;
        for (const n of fromA.dist.keys()) if (distanceM(coords.get(n)!, target) < distanceM(coords.get(x)!, target)) x = n;
        const fromB = dijkstra(allRail, b);
        let y = b;
        for (const n of fromB.dist.keys()) if (distanceM(coords.get(n)!, coords.get(x)!) < distanceM(coords.get(y)!, coords.get(x)!)) y = n;
        const head = pathTo(fromA.prev, a, x) ?? [a];
        const tail = (pathTo(fromB.prev, b, y) ?? [b]).reverse();
        pts = [...head, ...tail].map((n) => coords.get(n)!);
        bridged.push(`${spec.waypoints[i - 1].name}–${spec.waypoints[i].name} (${(distanceM(coords.get(x)!, coords.get(y)!) / 1000).toFixed(1)} km)`);
      } else {
        pts = [a !== null ? coords.get(a)! : [spec.waypoints[i - 1].lng, spec.waypoints[i - 1].lat], b !== null ? coords.get(b)! : [spec.waypoints[i].lng, spec.waypoints[i].lat]];
        bridged.push(`${spec.waypoints[i - 1].name}–${spec.waypoints[i].name} (no track near)`);
      }
      full.push(...(full.length ? pts.slice(1) : pts));
    }
    candidates = spec.waypoints.map((w, i) => {
      const at = ends[i] !== null ? coords.get(ends[i]!)! : ([w.lng, w.lat] as Pt);
      return { id: -1 - i, pt: at, tags: { name: w.name } };
    });
    if (bridged.length) console.log(`  ${spec.name}: no track between ${bridged.join(", ")} (straight across the gap)`);
  }
  if (!full || full.length < 2) {
    console.warn(`! ${spec.name}: no track found; skipped`);
    continue;
  }
  const path = simplify(full, 8);
  let length = 0;
  for (let i = 1; i < path.length; i++) length += distanceM(path[i - 1], path[i]);
  if (spec.nearStations) candidates = [...candidates, ...stations.filter((s) => project(path, s.pt).off < 300)];

  const stops: Line["stops"] = [];
  for (const s of candidates) {
    const name = spec.waypoints ? s.tags.name : stationName(s);
    const at = project(path, s.pt);
    if (!name || at.off > 400 || spec.notStations?.includes(name)) continue;
    // One stop per station (a route often lists the stop and the platform, both directions).
    if (stops.some((o) => o.name === name || Math.abs(o.along_m - at.along) < 300)) continue;
    stops.push({ name, lng: s.pt[0], lat: s.pt[1], along_m: Math.round(at.along) });
  }
  stops.sort((a, b) => a.along_m - b.along_m);
  if (stops.length < 2) {
    console.warn(`! ${spec.name}: fewer than two stations; skipped`);
    continue;
  }
  lines.push({ id: spec.id, name: spec.name, colour: spec.colour, path: path.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]), length_m: Math.round(length), stops });
  console.log(`  ${spec.name}: ${(length / 1000).toFixed(1)} km, ${path.length} points, ${stops.length} stations: ${stops.map((s) => s.name).join(", ")}`);
}

// ---- Bus stops and motor parks ----------------------------------------------
type Stop = { name: string; lng: number; lat: number; park: boolean };
const buses: Stop[] = [];
const addBus = (pt: Pt, tags: Tags, park: boolean) => {
  const near = buses.find((b) => distanceM([b.lng, b.lat], pt) < (park ? 80 : 30));
  if (near) {
    if (near.name === "Bus stop" && tags.name) near.name = tags.name;
    near.park ||= park;
    return;
  }
  buses.push({ name: tags.name ?? (park ? "Motor park" : "Bus stop"), lng: +pt[0].toFixed(6), lat: +pt[1].toFixed(6), park });
};
for (const s of busStops) addBus(s.pt, s.tags, s.tags.park === "yes");
for (const w of areaWays) {
  if (w.kind !== "park") continue;
  const c = centroid(w.refs);
  if (c) addBus(c, w.tags, true);
}

// ---- Airports ---------------------------------------------------------------
type Airport = { code: string; name: string; lng: number; lat: number };
const airports: Airport[] = [];
const terminals: { pt: Pt; size: number }[] = [
  ...terminalNodes.map((t) => ({ pt: t.pt, size: 1 })),
  ...areaWays.filter((w) => w.kind === "terminal").flatMap((w) => {
    const c = centroid(w.refs);
    return c ? [{ pt: c, size: w.refs.length }] : [];
  }),
];
const addAirport = (tags: Tags, centre: Pt | null) => {
  const code = CODE_FIXES[tags.name] ?? tags.iata;
  if (!centre || NOT_AIRPORTS.has(code) || airports.some((a) => a.code === code)) return;
  // Players go to the terminal (the biggest one), not the middle of the runway.
  const terminal = terminals.filter((t) => distanceM(t.pt, centre) < 4000).sort((a, b) => b.size - a.size)[0];
  const at = terminal?.pt ?? centre;
  airports.push({ code, name: tags.name.replace(/\s+/g, " ").trim(), lng: +at[0].toFixed(6), lat: +at[1].toFixed(6) });
};
for (const a of airportNodes) addAirport(a.tags, a.pt);
for (const w of areaWays) if (w.kind === "airport") addAirport(w.tags, centroid(w.refs));
for (const r of airportRelations) addAirport(r.tags, centroid(r.ways.flatMap((w) => memberWays.get(w) ?? [])));
airports.sort((a, b) => a.code.localeCompare(b.code));

writeFileSync(output, JSON.stringify({ built: new Date().toISOString(), lines, buses, airports }));
console.log(`done in ${elapsed()}: ${lines.length} train lines, ${buses.length} bus stops (${buses.filter((b) => b.park).length} motor parks), ${airports.length} airports`);
console.log("airports:", airports.map((a) => `${a.code} ${a.name}`).join(" | "));
